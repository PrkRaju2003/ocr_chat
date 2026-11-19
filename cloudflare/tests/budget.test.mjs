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
test("example metadata contains images only, never saved AI outputs", async () => {
  for (const id of ["linear", "quadratic", "calculus"]) {
    const r = await worker.fetch(
      new Request("https://example.com/api/examples/" + id),
      {},
    );
    assert.equal(r.status, 200);
    const data = await r.json();
    assert.deepEqual(Object.keys(data).sort(), ["image", "title"]);
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

test("every built-in image requires the live AI budget; none bypass it", async () => {
  const { readFile } = await import("node:fs/promises");
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
  for (const id of ["quadratic", "linear", "calculus"]) {
    const bytes = await readFile(
      new URL("../public/samples/" + id + ".png", import.meta.url),
    );
    const form = new FormData();
    form.append("image", new Blob([bytes], { type: "image/png" }), id + ".png");
    const r = await worker.fetch(
      new Request("https://example.com/api/ocr", {
        method: "POST",
        body: form,
      }),
      env,
    );
    assert.equal(r.status, 503);
  }
  assert.equal(invoked, false);
});
test("a previously recorded example now calls the solver and reviewer live", async () => {
  let calls = 0;
  const result = {
    title: "Composite quadratic",
    steps: [
      { explanation: "Substitute t=3x-2 and factor.", latex: "(t-6)(t+1)=0" },
    ],
    answer: "x=8/3,1/3",
    real_roots: [8 / 3, 1 / 3],
    assumptions: [],
  };
  const env = {
    REQUEST_LIMITER: { limit: async () => ({ success: true }) },
    TOTAL_LIMITER: { limit: async () => ({ success: true }) },
    INFERENCE_BUDGET: {
      idFromName: (n) => n,
      get: () => ({ fetch: async () => Response.json({ id: "test-only" }) }),
    },
    AI: {
      run: async () => ({
        response: JSON.stringify(
          ++calls === 1
            ? result
            : { verdict: "consistent", note: "Checked by review." },
        ),
      }),
    },
  };
  const r = await worker.fetch(
    new Request("https://example.com/api/solve", {
      method: "POST",
      body: JSON.stringify({ equation: "(3x - 2)^2 - 5(3x - 2) - 6 = 0" }),
    }),
    env,
  );
  assert.equal(r.status, 200);
  const data = await r.json();
  assert.equal(calls, 2);
  assert.equal(data.cache, undefined);
  assert.equal(data.check.status, "passed");
});
