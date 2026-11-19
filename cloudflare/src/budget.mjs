// Private, shared ledger. Reservations are charged before inference, including failures.
export const DAILY_NEURONS = 7500,
  RESERVE_NEURONS = 2500,
  MAX_IN_FLIGHT = 2,
  CALLS_PER_MINUTE = 20;
export class InferenceBudget {
  constructor(ctx) {
    this.ctx = ctx;
  }
  async fetch(request) {
    let body;
    try {
      body = await request.json();
    } catch {
      return Response.json(
        { error: "Invalid budget request" },
        { status: 400 },
      );
    }
    return this.ctx.storage.transaction(async (tx) => {
      const now = Date.now(),
        day = Math.floor(now / 86400000),
        minute = Math.floor(now / 60000);
      const state = (await tx.get("ledger")) || {
        day,
        minute,
        spent: 0,
        calls: 0,
        pending: {},
      };
      if (state.day !== day) {
        state.day = day;
        state.spent = 0;
      }
      if (state.minute !== minute) {
        state.minute = minute;
        state.calls = 0;
      }
      for (const [id, p] of Object.entries(state.pending))
        if (p.expires <= now) delete state.pending[id];
      if (body.action === "settle") {
        const p = state.pending[body.id];
        // Only one refund per reservation, only for validated provider token counts.
        if (
          p &&
          body.usage &&
          Number.isSafeInteger(body.usage.prompt_tokens) &&
          body.usage.prompt_tokens >= 0 &&
          body.usage.prompt_tokens <= 256000 &&
          Number.isSafeInteger(body.usage.completion_tokens) &&
          body.usage.completion_tokens >= 0 &&
          body.usage.completion_tokens <= 1900
        ) {
          const actual = Math.ceil(
            body.usage.prompt_tokens * 0.009091 +
              body.usage.completion_tokens * 0.027273,
          );
          if (p.day === day && actual <= p.reserved)
            state.spent -= p.reserved - actual;
        }
        if (p) delete state.pending[body.id];
        await tx.put("ledger", state);
        return Response.json({ settled: true });
      }
      if (body.action !== "reserve")
        return Response.json(
          { error: "Invalid budget action" },
          { status: 400 },
        );
      let error, retry_after;
      if (state.spent + RESERVE_NEURONS > DAILY_NEURONS) {
        error =
          "The daily live AI budget is resting. Please return after 00:00 UTC.";
        retry_after = Math.ceil(((day + 1) * 86400000 - now) / 1000);
      } else if (state.calls >= CALLS_PER_MINUTE) {
        error = "Live inference is busy. Please wait a minute.";
        retry_after = 60;
      } else if (Object.keys(state.pending).length >= MAX_IN_FLIGHT) {
        error = "Two AI tasks are already running. Please wait a moment.";
        retry_after = 15;
      }
      if (error) {
        await tx.put("ledger", state);
        return Response.json({ error, retry_after }, { status: 429 });
      }
      const id = crypto.randomUUID();
      state.spent += RESERVE_NEURONS;
      state.calls++;
      state.pending[id] = {
        reserved: RESERVE_NEURONS,
        expires: now + 120000,
        day,
      };
      await tx.put("ledger", state);
      return Response.json({ id, remaining: DAILY_NEURONS - state.spent });
    });
  }
}
export async function budgetCall(env, body) {
  if (!env.INFERENCE_BUDGET)
    throw Object.assign(
      Error("Live AI protection is unavailable. Please try again later."),
      { status: 503 },
    );
  const stub = env.INFERENCE_BUDGET.get(
    env.INFERENCE_BUDGET.idFromName("shared-ai-budget"),
  );
  const response = await stub.fetch("https://budget.internal/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok)
    throw Object.assign(Error(data.error || "Live inference is paused."), {
      status: response.status,
      retryAfter: data.retry_after,
    });
  return data;
}
