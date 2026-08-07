import assert from "node:assert/strict";
import test from "node:test";
import { isWorkerHealthy } from "../src/health.mjs";

test("health requires a recent successful poll", () => {
  const now = Date.parse("2026-08-07T10:00:00.000Z");
  assert.equal(isWorkerHealthy({ lastSuccessfulPollAt: null, lastError: null }, now, 3_000), false);
  assert.equal(isWorkerHealthy({ lastSuccessfulPollAt: "2026-08-07T09:59:30.000Z", lastError: null }, now, 3_000), true);
  assert.equal(isWorkerHealthy({ lastSuccessfulPollAt: "2026-08-07T09:58:00.000Z", lastError: null }, now, 3_000), false);
});

test("health reports poll errors even while the worker is busy", () => {
  const now = Date.parse("2026-08-07T10:00:00.000Z");
  assert.equal(isWorkerHealthy({
    lastSuccessfulPollAt: "2026-08-07T09:59:59.000Z",
    lastError: "Supabase unavailable",
    busy: true,
  }, now, 3_000), false);
  assert.equal(isWorkerHealthy({
    lastSuccessfulPollAt: "2026-08-07T09:59:59.000Z",
    lastError: null,
    busy: true,
  }, now, 3_000), true);
});
