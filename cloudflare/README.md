# Math Lab · Cloudflare Workers AI

Website: https://prk-math-solver.prk-math-ocr-worker.workers.dev/

A deployable Math OCR Solver showcase: upload a PNG/JPEG, review the recognized equation, get educational solution steps, and inspect the checks. This is a new Cloudflare implementation of the existing project. The older AWS implementation remains in the repository root, `frontend/`, `lambdas/`, and `ecs_worker/`.

## Architecture

Browser → Worker API → Workers AI (`env.AI`)

1. **Reader:** Gemma 4 vision transcribes the uploaded image. The browser requires a separate action to solve, giving the visitor an opportunity to correct OCR.
2. **Solver:** A bounded model call returns structured educational steps and an answer.
3. **Reviewer:** A separate call reviews the confirmed equation and proposed solution. It does not constitute a proof.
4. **Independent checker:** A small, non-evaluating polynomial parser calculates and checks complete numeric real root sets for degree-one/two equations in x. Unsupported problems are clearly labeled unverified; failed checks remain failed regardless of model review.

This is a bounded, role-based agent workflow. It does not claim autonomous planning, model training, or use of the Cloudflare Agents SDK. No model-generated code is executed. There are at most three inference calls for a custom photo-to-solution journey and two for a custom typed problem; there are no automatic inference retries. The three built-in image examples use labeled, recorded Workers AI results and require no new inference.

The default model is `@cf/google/gemma-4-26b-a4b-it`: a vision-capable mixture-of-experts model with about 4B active parameters per token and 26B total, hosted by Cloudflare. No model weights are downloaded into the Worker. The model ID is configurable through `MODEL`.

## Run and deploy

```sh
cd cloudflare
pnpm install --frozen-lockfile
pnpm test
pnpm check
pnpm build
pnpm exec wrangler login
pnpm dev
pnpm deploy
```

Wrangler 4.165.0 is pinned; Node 22.12+ is required. `wrangler.jsonc` includes static assets, the AI binding, and rate-limit bindings. Change `account_id` when deploying to another account. Production inference requires Cloudflare authentication and an AI-enabled account. A health response only reports configuration, not a successful inference test.

Workers AI uses real account quota even during `wrangler dev`. On Workers Free, the documented allowance is 10,000 neurons per day; requests fail after that limit. Paid accounts can incur usage charges. Do not upgrade the plan or enable paid billing just to run this demo without choosing a budget. See the current Cloudflare pricing documentation.

## API

| Endpoint          | Behavior                                                                                                             |
| ----------------- | -------------------------------------------------------------------------------------------------------------------- |
| `GET /api/health` | Binding configuration, model, limits                                                                                 |
| `POST /api/ocr`   | Multipart `image`; PNG/JPEG ≤1.5 MiB, dimensions ≤2048×2048; returns transcription and uncertainties                 |
| `POST /api/solve` | JSON `{ "equation": "x^2-5x+6=0" }`; ≤1,000 characters; returns solution, model review, independent check and timing |

Inputs are bounded before model calls. Two Cloudflare rate-limit bindings allow approximately 5 inference requests per client IP per minute and 30 in total per minute **per Cloudflare location**. These limits are approximate and are not a strict global spending cap. Exceeding either returns 429 with Retry-After. The client respects the cooldown. Missing protection fails closed. Provider/model errors return explicit errors instead of canned answers.

Visitor uploads and live solutions are not persisted by this application. They are sent to Cloudflare for inference. Worker observability is disabled to avoid logging prompts and images. This does not assert that Cloudflare's infrastructure has no request metadata. Authentication is unnecessary for the public demo. For a wider launch, add Turnstile and a strict cross-location quota/spend policy.

All model content is rendered through text nodes or local KaTeX with `trust:false` and bounded expansion. Scripts/fonts are local, with a restrictive CSP. KaTeX produces native MathML, which renders without inline styles. Static-asset headers are declared in `public/_headers`, since Cloudflare can serve assets without invoking the Worker. Browser tokens and service API keys are not required. Equation text from images is data, never authorization or instructions.

## Validation

`pnpm test` covers bounded OCR input, model response validation, workflow call budgets, throttling, origin rejection, independent polynomial checking, and malformed/malicious grammar. These are mocked inference tests, not an OCR accuracy benchmark. The included sample PNG is a printed quadratic for reproducible live checks; handwriting quality varies. The old fine-tuned Texify model is not run by this deployment.

## Sources

- [Workers AI Gemma 4 model and request schema](https://developers.cloudflare.com/workers-ai/models/gemma-4-26b-a4b-it/)
- [Gemma 4 model overview](https://ai.google.dev/gemma/docs/core)
- [Workers AI bindings and reasoning configuration](https://developers.cloudflare.com/workers-ai/get-started/workers-wrangler/)
- [Rate-limit scope and approximation](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/)
- [Workers AI pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/)

KaTeX 0.16.22 is bundled under its MIT license in `public/vendor/KATEX-LICENSE.txt`.

## Hosted verification

`hosted-check.json` records successful live printed-image OCR, quadratic/linear solutions, independent root checks, static CSP and 429/Retry-After throttling. Reproduce contract checks with `node scripts/smoke.mjs <url> --rate-limit`; this script does not invoke inference. Live browser checks are a small functional smoke test, not a handwriting accuracy benchmark.

## Shared inference budget and example images

The starting points are three advanced PNG image cases: a composite quadratic solved by substitution, a three-variable linear system, and a definite integral solved by integration by parts. Their responses in `examples/` were generated by Workers AI once and are explicitly labeled recorded/cached in the UI. Choosing one loads its image and recognized equation; Work it out displays its recorded solution. Editing it sends a live request. Exact example-image hashes and equation text also reuse the saved response on the server. This is not an OCR accuracy claim and modified uploads are not treated as the original sample.

A private SQLite-backed Durable Object, `InferenceBudget`, maintains one shared transactional ledger across every Worker instance and location. It enforces:

- **7,500 estimated neurons per UTC day**, leaving headroom below the documented 10,000-neuron free allowance.
- **2 live model calls in flight**, with 120-second leases. Timed-out/failed calls retain their reserved budget.
- **20 model-call starts per minute globally**, in addition to the existing approximate per-client/location throttles.
- **2,500 neurons reserved per call before inference**. The current Gemma context window and 1,900-token output cap bound the reservation conservatively using the published 9,091 input / 27,273 output neurons per million tokens. A successful response may refund the unused portion only when its provider token counts are valid. Missing usage never causes a refund. Duplicate settlements are ignored.

These are this application's conservative accounting controls, not Cloudflare's billing meter. Other applications share the account allowance; provider pricing, quotas, and availability can change. The model is locked to the reviewed Gemma ID for this budget. Changing it requires reviewing the reservation and token prices. No billing plan is upgraded. Durable Objects use the Workers Free-compatible SQLite backend. Only budget counters and bounded reservation IDs are stored, not images, equations, user IPs, or solutions.

When budget/concurrency/rate limits are reached, the API returns a clear 429 with Retry-After. Cached examples remain usable without accessing the live budget. API/model availability cannot be guaranteed against every provider or account-level limit.
