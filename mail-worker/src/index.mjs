import { randomBytes } from "node:crypto";
import http from "node:http";
import os from "node:os";
import { parseBoundedInteger, parsePublicAppOrigin } from "./config.mjs";
import { createMailPoller, parseMailJobStatus } from "./delivery.mjs";
import { createSmtpTransportManager } from "./smtpTransport.mjs";
import { isWorkerHealthy } from "./health.mjs";
import {
  DEFAULT_STORAGE_CLEANUP_INTERVAL_HOURS,
  DEFAULT_STORAGE_CLEANUP_RETENTION_HOURS,
  runScheduledStorageCleanup,
} from "./storageCleanup.mjs";

const supabaseUrl = String(process.env.SUPABASE_URL ?? "").replace(/\/+$/, "");
const serviceRoleKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY ?? "");
const encryptionKey = String(process.env.MAIL_SETTINGS_ENCRYPTION_KEY ?? "");
const appOrigin = parsePublicAppOrigin(process.env.PUBLIC_APP_URL);
const workerId = `${os.hostname()}:${process.pid}:${randomBytes(6).toString("hex")}`;
const pollIntervalMs = parseBoundedInteger(process.env.MAIL_WORKER_POLL_INTERVAL_MS, 3000, 1000, 2_147_483_647);
const concurrency = parseBoundedInteger(process.env.MAIL_WORKER_CONCURRENCY, 5, 1, 20);
const smtpTransports = createSmtpTransportManager({
  encryptionKey, concurrency, privateHosts: process.env.SMTP_ALLOWED_PRIVATE_HOSTS,
});
const healthPort = parseBoundedInteger(process.env.MAIL_WORKER_HEALTH_PORT, 8080, 1, 65535);
const healthHost = process.env.MAIL_WORKER_HEALTH_HOST?.trim() || "127.0.0.1";
// Allow a claimed batch to finish SMTP and retry its ACKs before Docker stops the container.
const SHUTDOWN_TIMEOUT_MS = 140_000;
const cleanupRetentionHours = Math.min(
  720,
  Math.max(
    168,
    Math.trunc(Number(process.env.STORAGE_CLEANUP_RETENTION_HOURS)) || DEFAULT_STORAGE_CLEANUP_RETENTION_HOURS,
  ),
);
const cleanupIntervalHours = Math.min(
  168,
  Math.max(
    1,
    Math.trunc(Number(process.env.STORAGE_CLEANUP_INTERVAL_HOURS)) || DEFAULT_STORAGE_CLEANUP_INTERVAL_HOURS,
  ),
);
const cleanupCheckIntervalMs = Math.min(
  6 * 60 * 60 * 1000,
  Math.max(60_000, Number(process.env.STORAGE_CLEANUP_CHECK_INTERVAL_MS) || 60 * 60 * 1000),
);

const state = {
  startedAt: new Date().toISOString(),
  lastPollAt: null,
  lastMailProgressAt: null,
  lastSuccessfulPollAt: null,
  lastSuccessAt: null,
  lastError: null,
  configured: false,
  busy: false,
  cleanupBusy: false,
  lastCleanupAttemptAt: null,
  lastCleanupSuccessAt: null,
  lastCleanupResult: null,
  lastCleanupError: null,
  lastNotificationCleanupAt: null,
  lastNotificationCleanupCount: null,
  lastNotificationCleanupError: null,
  lastAutomationPollAt: null,
  lastAutomationError: appOrigin ? null : "Задайте PUBLIC_APP_URL в виде http(s)://host[:port] для обработки автоматизаций",
};

function apiHeaders(prefer = "return=representation") {
  return {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
    "Content-Type": "application/json",
    Prefer: prefer,
  };
}

async function supabaseRequest(path, options = {}) {
  const response = await fetch(`${supabaseUrl}${path}`, {
    ...options,
    headers: { ...apiHeaders(), ...(options.headers ?? {}) },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(`Supabase API ${response.status}: ${body?.message ?? body?.error ?? "request failed"}`);
  }
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

async function callRpc(functionName, body) {
  return supabaseRequest(`/rest/v1/rpc/${functionName}`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

async function removeStorageObjects(bucket, names) {
  await supabaseRequest(`/storage/v1/object/${encodeURIComponent(bucket)}`, {
    method: "DELETE",
    body: JSON.stringify({ prefixes: names }),
  });
}

async function loadSettings() {
  const rows = await supabaseRequest(
    "/rest/v1/mail_settings?id=eq.1&select=enabled,host,port,ssl_mode,allow_invalid_certificate,username,password_encrypted,from_email,from_name,reply_to",
    { method: "GET" },
  );
  return Array.isArray(rows) ? rows[0] ?? null : null;
}

async function claimJobs() {
  const jobs = await supabaseRequest("/rest/v1/rpc/claim_mail_jobs", {
    method: "POST",
    body: JSON.stringify({ p_worker_id: workerId, p_limit: concurrency }),
  });
  return Array.isArray(jobs) ? jobs : [];
}

async function finishJob(jobId, success, error = null) {
  return supabaseRequest("/rest/v1/rpc/finish_mail_job", {
    method: "POST",
    body: JSON.stringify({
      p_job_id: jobId,
      p_worker_id: workerId,
      p_success: success,
      p_error: error,
    }),
  });
}

async function loadJobStatus(jobId) {
  const rows = await supabaseRequest(`/rest/v1/mail_queue?id=eq.${encodeURIComponent(jobId)}&select=status`, { method: "GET" });
  return parseMailJobStatus(rows);
}

const mailPoller = createMailPoller({ state, loadSettings, claimJobs, finishJob, loadJobStatus, smtpTransports });

async function cleanupStorage() {
  if (state.cleanupBusy) return;
  state.cleanupBusy = true;
  state.lastCleanupAttemptAt = new Date().toISOString();

  try {
    const result = await runScheduledStorageCleanup({
      rpc: callRpc,
      removeObjects: removeStorageObjects,
      workerId,
      retentionHours: cleanupRetentionHours,
      intervalHours: cleanupIntervalHours,
    });
    state.lastCleanupError = null;
    if (!result.skipped) {
      state.lastCleanupSuccessAt = new Date().toISOString();
      state.lastCleanupResult = {
        removedFiles: result.removedFiles,
        removedAssets: result.removedAssets,
        removedDocuments: result.removedDocuments,
      };
      console.info("scheduled storage cleanup completed", {
        runId: result.run?.id ?? null,
        ...state.lastCleanupResult,
      });
    }
  } catch (error) {
    state.lastCleanupError = error instanceof Error ? error.message : String(error);
    console.error("scheduled storage cleanup failed", { message: state.lastCleanupError });
  } finally {
    state.cleanupBusy = false;
  }
}

async function cleanupNotifications() {
  try {
    const removed = await callRpc("run_notification_cleanup", {});
    if (removed !== null && (!Number.isSafeInteger(removed) || removed < 0)) {
      throw new Error("Unexpected notification cleanup result");
    }
    state.lastNotificationCleanupError = null;
    // PostgreSQL returns null when another worker owns the run or the most
    // recent cleanup is still within the daily interval.
    if (removed !== null) {
      state.lastNotificationCleanupAt = new Date().toISOString();
      state.lastNotificationCleanupCount = removed;
      console.info("scheduled notification cleanup completed", { removed });
    }
  } catch (error) {
    state.lastNotificationCleanupError = error instanceof Error ? error.message : String(error);
    console.error("scheduled notification cleanup failed", { message: state.lastNotificationCleanupError });
  }
}

function assertEnvironment() {
  if (!supabaseUrl || !/^https?:\/\//.test(supabaseUrl)) throw new Error("SUPABASE_URL is required");
  if (!serviceRoleKey) throw new Error("SUPABASE_SERVICE_ROLE_KEY is required");
  if (Buffer.from(encryptionKey, "base64").length !== 32) throw new Error("MAIL_SETTINGS_ENCRYPTION_KEY must decode to 32 bytes");
}

assertEnvironment();

const server = http.createServer((request, response) => {
  if (request.url !== "/health") {
    response.writeHead(404).end();
    return;
  }
  const healthy = isWorkerHealthy(state, Date.now(), pollIntervalMs);
  response.writeHead(healthy ? 200 : 503, { "Content-Type": "application/json" });
  response.end(JSON.stringify({ ok: healthy, ...state, workerId }));
}).listen(healthPort, healthHost);

let activePoll = Promise.resolve();
function schedulePoll() {
  if (state.busy) return;
  activePoll = mailPoller.poll();
}

let activeCleanup = Promise.resolve();
let activeNotificationCleanup = null;
function scheduleCleanup() {
  if (!state.cleanupBusy) activeCleanup = cleanupStorage();
  activeNotificationCleanup ??= cleanupNotifications().finally(() => { activeNotificationCleanup = null; });
}

let activeAutomations = Promise.resolve();
let pollingAutomations = false;
function scheduleAutomations() {
  if (!appOrigin || pollingAutomations) return;
  pollingAutomations = true;
  activeAutomations = callRpc("process_automations", { p_app_origin: appOrigin, p_limit: 50 })
    .then(() => {
      state.lastAutomationPollAt = new Date().toISOString();
      state.lastAutomationError = null;
    })
    .catch((error) => {
      state.lastAutomationError = "Не удалось обработать события автоматизации";
      console.error("automation worker poll failed", { message: error instanceof Error ? error.message : String(error) });
    })
    .finally(() => { pollingAutomations = false; });
}

if (!appOrigin) console.error(state.lastAutomationError);
scheduleAutomations();
schedulePoll();
scheduleCleanup();
async function cleanupExpiredUploads() {
  try {
    for (let batch = 0; batch < 5; batch++) {
      const rows = await callRpc("list_expired_survey_uploads", { batch_limit: 100 });
      const names = (rows ?? []).map(row => row.name);
      if (!names.length) break;
      await removeStorageObjects("survey-files", names);
    }
    // Keep recent reservations for the IP budget, including manually removed files.
    await supabaseRequest(`/rest/v1/survey_upload_reservations?expires_at=lt.${encodeURIComponent(new Date(Date.now() - 8 * 86400000).toISOString())}`, {
      method: "DELETE",
      headers: { Prefer: "return=minimal" },
    });
    await callRpc("prune_survey_file_deletion_claims", { p_limit: 500 });
  } catch (error) {
    console.error("expired upload cleanup failed", { message: error instanceof Error ? error.message : String(error) });
  }
}

let activeExpiredUploads = null;
function scheduleExpiredUploads() {
  activeExpiredUploads ??= cleanupExpiredUploads().finally(() => { activeExpiredUploads = null; });
}
const expiredUploadsTimer = setInterval(scheduleExpiredUploads, 300000);
scheduleExpiredUploads();
const timer = setInterval(schedulePoll, pollIntervalMs);
const automationsTimer = setInterval(scheduleAutomations, Math.max(3000, pollIntervalMs));
const cleanupTimer = setInterval(scheduleCleanup, cleanupCheckIntervalMs);
let shuttingDown = false;

for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    setTimeout(() => {
      console.error("mail worker shutdown timed out", { pendingAcknowledgements: state.pendingAcknowledgements });
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS).unref();
    clearInterval(timer);
    clearInterval(automationsTimer);
    clearInterval(cleanupTimer);
    clearInterval(expiredUploadsTimer);
    mailPoller.stop();
    const flushPendingWithRetries = async () => {
      const delays = [0, 200, 500];
      for (const delayMs of delays) {
        if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
        await mailPoller.flushPending();
        if (!state.pendingAcknowledgements) break;
      }
    };
    await Promise.all([activePoll.then(flushPendingWithRetries), activeCleanup, activeNotificationCleanup, activeAutomations, activeExpiredUploads]);
    const { pendingAcknowledgements } = state;
    if (pendingAcknowledgements) {
      console.error("mail worker stopped with pending acknowledgements", { pendingAcknowledgements });
    }
    process.exitCode = pendingAcknowledgements ? 1 : 0;
    smtpTransports.close();
    server.close();
  });
}
