import http from "node:http";
import os from "node:os";
import nodemailer from "nodemailer";
import { createTransportOptions, decryptPassword, toPublicSmtpError } from "./config.mjs";

const supabaseUrl = String(process.env.SUPABASE_URL ?? "").replace(/\/+$/, "");
const serviceRoleKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY ?? "");
const encryptionKey = String(process.env.MAIL_SETTINGS_ENCRYPTION_KEY ?? "");
const workerId = `${os.hostname()}:${process.pid}`;
const pollIntervalMs = Math.max(1000, Number(process.env.MAIL_WORKER_POLL_INTERVAL_MS) || 3000);
const concurrency = Math.min(20, Math.max(1, Number(process.env.MAIL_WORKER_CONCURRENCY) || 5));
const healthPort = Math.min(65535, Math.max(1, Number(process.env.MAIL_WORKER_HEALTH_PORT) || 8080));

const state = {
  startedAt: new Date().toISOString(),
  lastPollAt: null,
  lastSuccessAt: null,
  lastError: null,
  configured: false,
  busy: false,
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

  try {
    const settings = await loadSettings();
    state.configured = Boolean(settings?.enabled);
    if (!settings?.enabled) {
      state.lastError = null;
      return;
    }

    const jobs = await claimJobs();
    if (jobs.length === 0) {
      state.lastError = null;
      return;
    }

    try {
      const password = decryptPassword(settings.password_encrypted, encryptionKey);
      transporter = nodemailer.createTransport(createTransportOptions(settings, password));
      await Promise.all(jobs.map((job) => sendJob(transporter, settings, job)));
      state.lastError = null;
    } catch (error) {
      const publicError = toPublicSmtpError(error);
      state.lastError = publicError;
      await Promise.all(jobs.map((job) => finishJob(job.id, false, publicError)));
    }
  } catch (error) {
    state.lastError = "Не удалось получить задания из Supabase";
    console.error("mail worker poll failed", { message: error instanceof Error ? error.message : String(error) });
  } finally {
    transporter?.close();
    state.busy = false;
  }
}

function assertEnvironment() {
  if (!supabaseUrl || !/^https?:\/\//.test(supabaseUrl)) throw new Error("SUPABASE_URL is required");
  if (!serviceRoleKey) throw new Error("SUPABASE_SERVICE_ROLE_KEY is required");
  if (Buffer.from(encryptionKey, "base64").length !== 32) throw new Error("MAIL_SETTINGS_ENCRYPTION_KEY must decode to 32 bytes");
}

assertEnvironment();

http.createServer((request, response) => {
  if (request.url !== "/health") {
    response.writeHead(404).end();
    return;
  }
  const healthy = Boolean(state.lastPollAt) && !state.busy;
  response.writeHead(healthy ? 200 : 503, { "Content-Type": "application/json" });
  response.end(JSON.stringify({ ok: healthy, ...state, workerId }));
}).listen(healthPort, "0.0.0.0");

void poll();
const timer = setInterval(() => void poll(), pollIntervalMs);

for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => {
    clearInterval(timer);
    process.exit(0);
  });
}
