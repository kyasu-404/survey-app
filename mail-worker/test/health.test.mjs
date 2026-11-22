import assert from "node:assert/strict";
import test from "node:test";
import { isWorkerHealthy } from "../src/health.mjs";

const delivered = "2026-08-07T09:59:30.000Z";
const processed = "2026-08-07T09:59:59.000Z";

test("health requires a recent successful poll", () => {
  const now = Date.parse("2026-08-07T10:00:00.000Z");
  const state = { lastSuccessfulPollAt: delivered, lastAutomationPollAt: processed, lastError: null };
  assert.equal(isWorkerHealthy(state, now, 3_000), true);
  assert.equal(isWorkerHealthy({ ...state, lastSuccessfulPollAt: null }, now, 3_000), false);
  assert.equal(isWorkerHealthy({ ...state, lastSuccessfulPollAt: "2026-08-07T09:58:00.000Z" }, now, 3_000), false);
});

test("successful mail polling cannot mask a failed or stalled automation scheduler", () => {
  const now = Date.parse("2026-08-07T10:00:00.000Z");
  const state = { lastSuccessfulPollAt: delivered, lastAutomationPollAt: processed, lastError: null };
  assert.equal(isWorkerHealthy({ ...state, lastAutomationError: "RPC failed" }, now, 3_000), false);
  assert.equal(isWorkerHealthy({ ...state, lastAutomationPollAt: null }, now, 3_000), false);
  assert.equal(isWorkerHealthy({ ...state, lastAutomationPollAt: "2026-08-07T09:58:00.000Z" }, now, 3_000), false);
  assert.equal(isWorkerHealthy(state, now, 3_000), true);
});

test("health reports poll errors even while the worker is busy", () => {
  const now = Date.parse("2026-08-07T10:00:00.000Z");
  assert.equal(isWorkerHealthy({
    lastSuccessfulPollAt: "2026-08-07T09:59:59.000Z",
    lastAutomationPollAt: processed,
    lastError: "Supabase unavailable",
    busy: true,
  }, now, 3_000), false);
  assert.equal(isWorkerHealthy({
    lastSuccessfulPollAt: "2026-08-07T09:59:59.000Z",
    lastAutomationPollAt: processed,
    lastError: null,
    busy: true,
  }, now, 3_000), true);
});
