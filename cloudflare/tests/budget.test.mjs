import { test } from "node:test";
import assert from "node:assert/strict";
import { InferenceBudget } from "../src/budget.mjs";
import worker from "../src/index.mjs";
function ledger() {
  let saved,
    queue = Promise.resolve();
  return new InferenceBudget({
    storage: {
      transaction: (fn) => {
        const call = queue.then(() =>
          fn({
            get: async () => structuredClone(saved),
            put: async (_, v) => {
              saved = structuredClone(v);
            },
          }),
        );
        queue = call.catch(() => {});
        return call;
      },
    },
  });
}
async function call(gate, body) {
  const r = await gate.fetch(
    new Request("https://internal/", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  );
  return { status: r.status, ...(await r.json()) };
}
test("parallel reservations enforce a shared two-call concurrency cap", async () => {
  const gate = ledger();
  const result = await Promise.all(
    Array.from({ length: 8 }, () => call(gate, { action: "reserve" })),
  );
  assert.equal(result.filter((r) => r.status === 200).length, 2);
  assert.equal(result.filter((r) => r.status === 429).length, 6);
});
test("missing usage retains full charge and the fourth 2500-neuron call is denied", async () => {
  const gate = ledger();
  for (let i = 0; i < 3; i++) {
    const r = await call(gate, { action: "reserve" });
    assert.equal(r.status, 200);
    await call(gate, { action: "settle", id: r.id });
  }
  const r = await call(gate, { action: "reserve" });
  assert.equal(r.status, 429);
  assert.match(r.error, /daily/);
  assert.ok(r.retry_after > 0);
});
test("provider usage settles once; forged duplicate refunds are ignored", async () => {
  const gate = ledger();
  const r = await call(gate, { action: "reserve" });
  const usage = { prompt_tokens: 1000, completion_tokens: 100 };
  await call(gate, { action: "settle", id: r.id, usage });
  await call(gate, { action: "settle", id: r.id, usage });
  const a = await call(gate, { action: "reserve" });
  assert.equal(a.remaining, 4988);
});
test("UTC reset clears the daily budget, while timed-out calls are never refunded", async () => {
  const original = Date.now;
  let now = Date.UTC(2026, 10, 18, 10);
  Date.now = () => now;
  try {
    const gate = ledger();
    for (let i = 0; i < 3; i++) {
      assert.equal((await call(gate, { action: "reserve" })).status, 200);
      now += 121000;
    }
    assert.equal((await call(gate, { action: "reserve" })).status, 429);
    now += 86400000;
    assert.equal((await call(gate, { action: "reserve" })).status, 200);
  } finally {
    Date.now = original;
  }
});
test("global minute cap cannot be bypassed by fast settlement", async () => {
  const gate = ledger();
  for (let i = 0; i < 20; i++) {
    const r = await call(gate, { action: "reserve" });
    assert.equal(r.status, 200);
    await call(gate, {
      action: "settle",
      id: r.id,
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    });
  }
  const r = await call(gate, { action: "reserve" });
  assert.equal(r.status, 429);
  assert.match(r.error, /minute/);
});
test("cached examples need no AI or budget binding", async () => {
  const env = {
    REQUEST_LIMITER: { limit: async () => ({ success: true }) },
    TOTAL_LIMITER: { limit: async () => ({ success: true }) },
  };
  for (const id of ["linear", "quadratic", "calculus"]) {
    const r = await worker.fetch(
      new Request("https://example.com/api/examples/" + id),
      env,
    );
    assert.equal(r.status, 200);
    const e = await r.json();
    assert.equal(e.cache.kind, "example");
    const solved = await worker.fetch(
      new Request("https://example.com/api/solve", {
        method: "POST",
        body: JSON.stringify({ equation: e.equation }),
      }),
      env,
    );
    assert.equal(solved.status, 200);
    assert.equal((await solved.json()).cache.kind, "example");
  }
});
test("uncached problems fail closed when the budget binding is missing", async () => {
  let invoked = false;
  const env = {
    REQUEST_LIMITER: { limit: async () => ({ success: true }) },
    TOTAL_LIMITER: { limit: async () => ({ success: true }) },
    AI: {
      run: async () => {
        invoked = true;
      },
    },
  };
  const r = await worker.fetch(
    new Request("https://example.com/api/solve", {
      method: "POST",
      body: JSON.stringify({ equation: "9x=81" }),
    }),
    env,
  );
  assert.equal(r.status, 503);
  assert.equal(invoked, false);
});

test("advanced images match their recorded equations and reference answers", async () => {
  const { readFile } = await import("node:fs/promises");
  const { examples, cachedImage } = await import("../src/examples.mjs");
  const { checkRoots } = await import("../src/math.mjs");
  for (const id of ["quadratic", "linear", "calculus"]) {
    const bytes = await readFile(
      new URL("../public/samples/" + id + ".png", import.meta.url),
    );
    const result = await cachedImage(bytes);
    assert.equal(result.equation, examples[id].equation);
  }
  assert.equal(
    checkRoots(
      examples.quadratic.equation,
      examples.quadratic.solution.real_roots,
    ).status,
    "passed",
  );
  assert.match(
    examples.linear.solution.answer.replace(/\s/g, ""),
    /x=2.*y=3.*z=-1/,
  );
  assert.equal(2 * 2 + 3 - -1, 8);
  assert.equal(-3 * 2 - 3 + 2 * -1, -11);
  assert.equal(-2 * 2 + 3 + 2 * -1, -3);
  assert.equal(examples.calculus.solution.answer, "1");
  // F(x)=e^x(x-1), so F(1)-F(0)=1; the runtime does not claim general calculus verification.
  assert.equal(Math.exp(1) * (1 - 1) - Math.exp(0) * (0 - 1), 1);
});
