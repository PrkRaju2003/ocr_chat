import { test } from "node:test";
import assert from "node:assert/strict";
import worker, { parseModelJSON } from "../src/index.mjs";
import { polynomial, checkRoots } from "../src/math.mjs";
const base = "https://math.example";
const allowed = { limit: async () => ({ success: true }) };
const answer = {
  title: "Quadratic equation",
  steps: [{ explanation: "Factor the polynomial.", latex: "(x-2)(x-3)=0" }],
  answer: "x=2\\;\\text{or}\\;x=3",
  real_roots: [2, 3],
  assumptions: ["Real x"],
};
function env(
  results = [
    answer,
    { verdict: "consistent", note: "Both values satisfy the equation." },
  ],
) {
  let calls = [];
  return {
    INFERENCE_BUDGET: {
      idFromName: (n) => n,
      get: () => ({
        fetch: async () =>
          Response.json({ id: "test-reservation", settled: true }),
      }),
    },
    REQUEST_LIMITER: allowed,
    TOTAL_LIMITER: allowed,
    AI: {
      run: async (model, input) => {
        calls.push({ model, input });
        return {
          choices: [
            {
              finish_reason: "stop",
              message: { content: JSON.stringify(results.shift()) },
            },
          ],
        };
      },
    },
    calls,
  };
}
function solve(equation = "x^2-5*x+6=0", extra = {}) {
  return new Request(base + "/api/solve", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: base },
    body: JSON.stringify({ equation }),
    ...extra,
  });
}
test("polynomial grammar handles both sides, fractions and parentheses", () => {
  assert.deepEqual(polynomial("x^2 - 5x + 6 = 0"), [6, -5, 1]);
  assert.deepEqual(polynomial("3*x + 7 = 22"), [-15, 3, 0]);
  assert.deepEqual(polynomial("(x-2)*(x-3)=0"), [6, -5, 1]);
  assert.deepEqual(polynomial("x/2=4"), [-4, 0.5, 0]);
});
test("refuses code, functions, high powers and ambiguous grammar", () => {
  for (const s of [
    "fetch(1)=0",
    "x^99=0",
    "x/x=1",
    "sin(x)=0",
    "x^2+1",
    "x=1=2",
    "1e999*x=0",
    "x**2=0",
  ])
    assert.equal(polynomial(s), null, s);
});
test("root check requires complete roots and rejects wrong/non-numeric roots", () => {
  assert.equal(checkRoots("x^2-5x+6=0", [2, 3]).status, "passed");
  for (const roots of [[2], [2, 4], ["2", 3], [], [Infinity]])
    assert.equal(checkRoots("x^2-5x+6=0", roots).status, "failed");
  assert.equal(checkRoots("3x+7=22", [5]).status, "passed");
  assert.equal(checkRoots("x^2=0", [0]).status, "passed");
  assert.equal(checkRoots("x^2+1=0", []).status, "not_supported");
});
test("parses native and legacy model responses without trusting partial output", () => {
  assert.equal(parseModelJSON({ response: '```json\n{"x":1}\n```' }).x, 1);
  assert.throws(() =>
    parseModelJSON({
      choices: [{ finish_reason: "length", message: { content: "{}" } }],
    }),
  );
  assert.throws(() => parseModelJSON({ response: "not json" }));
});
test("solve makes bounded model calls, independently checks roots, and never executes generated code", async () => {
  const e = env(),
    r = await worker.fetch(solve(), e),
    data = await r.json();
  assert.equal(r.status, 200);
  assert.equal(data.check.status, "passed");
  assert.equal(data.review.verdict, "consistent");
  assert.equal(e.calls.length, 2);
  assert.ok(e.calls[0].input.max_completion_tokens <= 1900);
  assert.equal(r.headers.get("Cache-Control"), "no-store");
  assert.ok(
    r.headers.get("Content-Security-Policy").includes("script-src 'self'"),
  );
});
test("wrong answer remains marked failed even when reviewer agrees", async () => {
  const e = env([
    { ...answer, real_roots: [1, 3] },
    { verdict: "consistent", note: "Looks okay" },
  ]);
  const d = await (await worker.fetch(solve(), e)).json();
  assert.equal(d.check.status, "failed");
});
test("rate limit rejects before inference with Retry-After", async () => {
  const e = env();
  e.REQUEST_LIMITER = { limit: async () => ({ success: false }) };
  const r = await worker.fetch(solve(), e);
  assert.equal(r.status, 429);
  assert.equal(r.headers.get("Retry-After"), "60");
  assert.equal(e.calls.length, 0);
});
test("cross-origin writes, long input and unavailable protection are rejected", async () => {
  let e = env();
  assert.equal(
    (
      await worker.fetch(
        solve("x=1", { headers: { Origin: "https://evil.example" } }),
        e,
      )
    ).status,
    403,
  );
  assert.equal((await worker.fetch(solve("x".repeat(1001)), e)).status, 422);
  delete e.REQUEST_LIMITER;
  assert.equal((await worker.fetch(solve(), e)).status, 503);
  assert.equal(e.calls.length, 0);
});
test("non-image multipart cannot consume model inference", async () => {
  const e = env(),
    form = new FormData();
  form.append(
    "image",
    new Blob(["fake image"], { type: "image/png" }),
    "bad.png",
  );
  const r = await worker.fetch(
    new Request(base + "/api/ocr", { method: "POST", body: form }),
    e,
  );
  assert.equal(r.status, 415);
  assert.equal(e.calls.length, 0);
});
test("sample image OCR uses vision content and returns transcription for confirmation", async () => {
  const { readFile } = await import("node:fs/promises");
  const bytes = await readFile(
    new URL("../public/samples/quadratic.png", import.meta.url),
  );
  const e = env([
    {
      equation: "x^2-5x+6=0",
      latex: "x^2-5x+6=0",
      uncertainties: [],
      is_math: true,
    },
  ]);
  const form = new FormData();
  form.append(
    "image",
    new Blob([bytes, new Uint8Array([0])], { type: "image/png" }),
    "quadratic.png",
  );
  const r = await worker.fetch(
    new Request(base + "/api/ocr", { method: "POST", body: form }),
    e,
  );
  assert.equal(r.status, 200);
  assert.equal((await r.json()).equation, "x^2-5x+6=0");
  assert.equal(e.calls.length, 1);
  assert.ok(
    e.calls[0].input.messages[1].content[1].image_url.url.startsWith(
      "data:image/png;base64,",
    ),
  );
});

test("math output uses native MathML without inline styles or executable markup", async () => {
  const katex = (await import("katex")).default;
  for (const latex of [
    "(x-2)(x-3)=0",
    "x=2,3",
    "\\frac{d}{dx}x^3=3x^2",
    "\\int x^2 dx=\\frac{x^3}{3}+C",
  ]) {
    const html = katex.renderToString(latex, {
      output: "mathml",
      trust: false,
      throwOnError: true,
    });
    assert.ok(html.includes("<math"));
    assert.ok(!html.includes("style="));
    assert.ok(!/<script|onerror=|onclick=/.test(html));
  }
});
