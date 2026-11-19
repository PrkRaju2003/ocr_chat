// Hosted contract checks; --rate-limit consumes quota but makes no AI calls.
const base =
  process.argv[2] || "https://prk-math-solver.prk-math-ocr-worker.workers.dev";
const health = await fetch(base + "/api/health");
if (!health.ok) throw Error("Health endpoint failed");
const info = await health.json();
if (info.provider !== "Cloudflare Workers AI" || !info.live)
  throw Error("AI binding unavailable");
const page = await fetch(base + "/");
if (
  !page.ok ||
  !(page.headers.get("Content-Security-Policy") || "").includes(
    "script-src 'self'",
  )
)
  throw Error("Website or CSP missing");
const result = {
  url: base,
  health: "passed",
  website: "passed",
  model: info.model,
  rate_limit: "not run",
  inference: "not exercised by this script",
};
if (process.argv.includes("--rate-limit")) {
  const statuses = [];
  for (let i = 0; i < 10; i++) {
    const response = await fetch(base + "/api/solve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    statuses.push(response.status);
    if (![422, 429].includes(response.status))
      throw Error("Unexpected invalid-input response: " + response.status);
    if (
      response.status === 429 &&
      Number(response.headers.get("Retry-After")) < 1
    )
      throw Error("Retry-After missing");
    await response.text();
    if (response.status === 429) break;
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  if (!statuses.includes(429)) throw Error("Rate limit not enforced");
  result.rate_limit = "passed";
  result.invalid_input_statuses = statuses;
}
console.log(JSON.stringify(result, null, 2));
