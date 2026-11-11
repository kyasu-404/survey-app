import { toPublicSmtpError } from "./config.mjs";

const ACK_ERROR = "Не удалось подтвердить обработку писем в Supabase";

export function parseMailJobStatus(rows) {
  if (!Array.isArray(rows) || rows.length > 1) throw new Error("Malformed mail queue status response");
  if (rows.length === 0) return null;
  if (!["queued", "processing", "sent", "failed"].includes(rows[0]?.status)) {
    throw new Error("Malformed mail queue status response");
  }
  return rows[0];
}

export function createMailPoller({
  state, loadSettings, claimJobs, finishJob, loadJobStatus, smtpTransports,
  logger = console, now = () => new Date(),
}) {
  // Retry queue acknowledgements independently from SMTP delivery. This state
  // survives failed polls, not process crashes or another worker's lease claim.
  const pending = new Map();
  state.pendingAcknowledgements = 0;

  function remember(job, success, error = null) {
    const acknowledgement = { job, success, error };
    pending.set(job.id, acknowledgement);
    state.pendingAcknowledgements = pending.size;
    return acknowledgement;
  }

  async function acknowledge({ job, success, error }) {
    try {
      let deliveryConfirmed = success;
      const status = await finishJob(job.id, success, error);
      if (success && status !== "sent") {
        // A retry after a lost response is a SQL no-op, as is a lost lease.
        // Confirm the persisted result before clearing an accepted message.
        const persisted = await loadJobStatus(job.id);
        if (persisted === null) {
          // Deleting a form/batch cascades its jobs even during SMTP delivery.
          // Confirmed absence is terminal; it must not block unrelated mail.
          deliveryConfirmed = false;
          logger.warn("mail job acknowledgement cancelled because the job was deleted", { jobId: job.id, batchId: job.batch_id });
        } else if (persisted.status === "failed") {
          // A foreign worker can exhaust retries after reclaiming an expired
          // lease. Surface this terminal conflict without freezing all mail.
          deliveryConfirmed = false;
          state.lastAcknowledgementConflict = { jobId: job.id, status: persisted.status, at: now().toISOString() };
          logger.error("mail delivery acknowledgement conflicts with terminal queue status", { jobId: job.id, batchId: job.batch_id, status: persisted.status });
        } else if (persisted.status !== "sent") {
          throw new Error("Mail delivery acknowledgement is unconfirmed");
        }
      }
      pending.delete(job.id);
      state.pendingAcknowledgements = pending.size;
      if (deliveryConfirmed) state.lastSuccessAt = now().toISOString();
    } catch (error) {
      state.lastError = ACK_ERROR;
      logger.error("mail job acknowledgement failed", { jobId: job.id, batchId: job.batch_id, code: error?.code ?? null });
    }
  }

  async function sendJob(transporter, settings, job) {
    let success = true;
    let publicError = null;
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
    } catch (error) {
      success = false;
      publicError = toPublicSmtpError(error);
      logger.error("mail delivery failed", { jobId: job.id, batchId: job.batch_id, code: error?.code ?? null });
    }
    // Once SMTP accepted a message, no acknowledgement error may change this
    // outcome to failure or invoke sendMail again for the pending job.
    await acknowledge(remember(job, success, publicError));
  }

  return async function poll() {
    if (state.busy) return;
    state.busy = true;
    state.lastPollAt = now().toISOString();
    let completed = false;

    try {
      // Do this even when SMTP has since been disabled. Do not claim more jobs
      // while an earlier accepted message could be reclaimed after lease expiry.
      await Promise.all([...pending.values()].map(acknowledge));
      if (pending.size) {
        state.lastError = ACK_ERROR;
        return;
      }

      const settings = await loadSettings();
      state.configured = Boolean(settings?.enabled);
      if (!settings?.enabled) {
        smtpTransports.close();
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

      let transporter;
      try {
        transporter = smtpTransports.get(settings);
      } catch (error) {
        const publicError = toPublicSmtpError(error);
        // No SMTP send has started, so these jobs can safely be retried.
        await Promise.all(jobs.map((job) => acknowledge(remember(job, false, publicError))));
        state.lastError = pending.size ? ACK_ERROR : publicError;
        return;
      }

      // A sibling's error must never requeue the whole batch, and a poll must
      // remain busy until every in-flight delivery has finished.
      const results = await Promise.allSettled(jobs.map((job) => sendJob(transporter, settings, job)));
      if (pending.size || results.some((result) => result.status === "rejected")) {
        state.lastError = ACK_ERROR;
        return;
      }
      state.lastError = null;
      completed = true;
    } catch (error) {
      state.lastError = "Не удалось получить задания из Supabase";
      logger.error("mail worker poll failed", { message: error instanceof Error ? error.message : String(error) });
    } finally {
      if (completed) state.lastSuccessfulPollAt = now().toISOString();
      state.busy = false;
    }
  };
}
