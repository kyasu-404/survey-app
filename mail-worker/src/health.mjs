export function isWorkerHealthy(state, nowMs, pollIntervalMs) {
  const freshnessWindowMs = Math.max(60_000, Math.max(1_000, pollIntervalMs) * 3);

  return !state.lastError && !state.lastAutomationError
    && [state.lastSuccessfulPollAt, state.lastAutomationPollAt].every((lastPoll) => {
      const ageMs = nowMs - Date.parse(lastPoll ?? "");
      return ageMs >= 0 && ageMs <= freshnessWindowMs;
    });
}
