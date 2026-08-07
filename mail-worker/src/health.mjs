export function isWorkerHealthy(state, nowMs, pollIntervalMs) {
  const successfulPollMs = Date.parse(String(state.lastSuccessfulPollAt ?? ""));
  const freshnessWindowMs = Math.max(60_000, Math.max(1_000, pollIntervalMs) * 3);

  return Number.isFinite(successfulPollMs)
    && nowMs - successfulPollMs <= freshnessWindowMs
    && nowMs >= successfulPollMs
    && !state.lastError;
}
