// A claimed batch can still be working through SMTP and Supabase timeouts.
const ACTIVE_MAIL_FRESHNESS_MS = 120_000;

export function isWorkerHealthy(state, nowMs, pollIntervalMs) {
  const freshnessWindowMs = Math.max(60_000, Math.max(1_000, pollIntervalMs) * 3);
  function isFresh(lastPoll, windowMs) {
    const ageMs = nowMs - Date.parse(lastPoll ?? "");
    return ageMs >= 0 && ageMs <= windowMs;
  }

  return !state.lastError && !state.lastAutomationError
    && isFresh(state.lastAutomationPollAt, freshnessWindowMs)
    && (state.busy
      ? isFresh(state.lastMailProgressAt, ACTIVE_MAIL_FRESHNESS_MS)
      : isFresh(state.lastSuccessfulPollAt, freshnessWindowMs));
}
