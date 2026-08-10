import http from "node:http";
import os from "node:os";
import nodemailer from "nodemailer";
import { createTransportOptions, decryptPassword, toPublicSmtpError } from "./config.mjs";
import { isWorkerHealthy } from "./health.mjs";
import {
  DEFAULT_STORAGE_CLEANUP_INTERVAL_HOURS,
  DEFAULT_STORAGE_CLEANUP_RETENTION_HOURS,
  runScheduledStorageCleanup,
} from "./storageCleanup.mjs";

const supabaseUrl = String(process.env.SUPABASE_URL ?? "").replace(/\/+$/, "");
const serviceRoleKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY ?? "");
const encryptionKey = String(process.env.MAIL_SETTINGS_ENCRYPTION_KEY ?? "");
const workerId = `${os.hostname()}:${process.pid}`;
const pollIntervalMs = Math.max(1000, Number(process.env.MAIL_WORKER_POLL_INTERVAL_MS) || 3000);
const concurrency = Math.min(20, Math.max(1, Number(process.env.MAIL_WORKER_CONCURRENCY) || 5));
const healthPort = Math.min(65535, Math.max(1, Number(process.env.MAIL_WORKER_HEALTH_PORT) || 8080));
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
  const text = await response.text();
  const body = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new Error(`Supabase API ${response.status}: ${body?.message ?? body?.error ?? "request failed"}`);
  }
  return body;
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
    "/rest/v1/mail_settings?id=eq.1&select=enabled,host,port,ssl_mode,username,password_encrypted,from_email,from_name,reply_to",
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
  await supabaseRequest("/rest/v1/rpc/finish_mail_job", {
    method: "POST",
    body: JSON.stringify({
      p_job_id: jobId,
      p_worker_id: workerId,
      p_success: success,
      p_error: error,
    }),
  });
}

async function sendJob(transporter, settings, job) {
  try {
    await transporter.sendMail({
      from: { name: settings.from_name, address: settings.from_email },
      replyTo: settings.reply_to || undefined,
      to: { name: job.recipient_name, address: job.recipient_email },
      subject: job.subject,
      text: job.body_text,
      disableFileAccess: true,
      disableUrlAccess: true,
    });
    await finishJob(job.id, true);
    state.lastSuccessAt = new Date().toISOString();
  } catch (error) {
    const publicError = toPublicSmtpError(error);
    console.error("mail delivery failed", { jobId: job.id, batchId: job.batch_id, code: error?.code ?? null });
    await finishJob(job.id, false, publicError);
  }
}

async function poll() {
  if (state.busy) return;
  state.busy = true;
  state.lastPollAt = new Date().toISOString();
  let transporter;
  let completed = false;

  try {
    const settings = await loadSettings();
    state.configured = Boolean(settings?.enabled);
    if (!settings?.enabled) {
      state.lastError = null;
      completed = true;
      return;
    }

    const jobs = await claimJobs();
    if (jobs.length === 0) {
      state.lastError = null;
      completed = true;
      return;
    }

    try {
      const password = decryptPassword(settings.password_encrypted, encryptionKey);
      transporter = nodemailer.createTransport(createTransportOptions(settings, password));
      await Promise.all(jobs.map((job) => sendJob(transporter, settings, job)));
      state.lastError = null;
      completed = true;
    } catch (error) {
      const publicError = toPublicSmtpError(error);
      state.lastError = publicError;
      await Promise.all(jobs.map((job) => finishJob(job.id, false, publicError)));
    }
  } catch (error) {
    state.lastError = "Не удалось получить задания из Supabase";
    console.error("mail worker poll failed", { message: error instanceof Error ? error.message : String(error) });
  } finally {
    if (completed) state.lastSuccessfulPollAt = new Date().toISOString();
    transporter?.close();
    state.busy = false;
  }
}

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
}).listen(healthPort, "0.0.0.0");

let activePoll = Promise.resolve();
function schedulePoll() {
  if (state.busy) return;
  activePoll = poll();
}

let activeCleanup = Promise.resolve();
function scheduleCleanup() {
  if (state.cleanupBusy) return;
  activeCleanup = cleanupStorage();
}

schedulePoll();
scheduleCleanup();
const timer = setInterval(schedulePoll, pollIntervalMs);
const cleanupTimer = setInterval(scheduleCleanup, cleanupCheckIntervalMs);
let shuttingDown = false;

for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    clearInterval(timer);
    clearInterval(cleanupTimer);
    await Promise.all([activePoll, activeCleanup]);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 10_000).unref();
  });
}
