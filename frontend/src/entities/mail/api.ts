import { apiClient, supabaseClient } from "../../shared/api";
import { runRequest } from "../../shared/api/request";
import type { MailActivity, MailBatch, MailJob, QueueMailResult, SmtpSettings, SmtpSettingsDraft } from "./types";

type MailAdminAction =
  | { action: "get-settings" }
  | ({ action: "save-settings" } & SmtpSettingsDraft)
  | { action: "queue-test"; recipientEmail: string }
  | { action: "queue-reminders"; formId: string };

async function getFunctionErrorMessage(error: unknown, response?: Response) {
  const errorResponse = response ?? (error instanceof Error && "context" in error ? error.context : undefined);
  if (errorResponse instanceof Response) {
    const payload = await errorResponse.clone().json().catch(() => null) as {
      code?: unknown;
      error?: unknown;
      message?: unknown;
    } | null;
    const details = [payload?.error, payload?.message]
      .find((value): value is string => typeof value === "string" && Boolean(value.trim()))
      ?.trim();
    const functionIsMissing = errorResponse.status === 404
      || payload?.code === "NOT_FOUND"
      || /function not found/i.test(details ?? "");
    if (functionIsMissing) {
      return "Почтовый модуль mail-admin не развёрнут в Supabase. Установите миграцию и модуль по инструкции в README.";
    }
    if (details) return details;
  }
  if (error instanceof Error && /edge function returned a non-2xx status code/i.test(error.message)) {
    return "Почтовый модуль mail-admin недоступен. Проверьте его развёртывание в Supabase по инструкции в README.";
  }
  return error instanceof Error && error.message.trim()
    ? error.message
    : "Не удалось выполнить почтовую операцию";
}

async function callMailAdmin<T>(payload: MailAdminAction) {
  const { data: { session } } = await runRequest("auth.getSession", () => apiClient.auth.getCurrentSession());
  if (!session?.access_token) throw new Error("Сессия авторизации не готова. Попробуйте обновить страницу.");

  const { data, error, response } = await runRequest(
    `functions.mail-admin.${payload.action}`,
    (_signal, traceContext) => supabaseClient.functions.invoke<T>("mail-admin", {
      body: payload,
      headers: { ...traceContext.headers, Authorization: `Bearer ${session.access_token}` },
    }),
    { context: { action: payload.action }, timeoutMs: 30_000 },
  );
  if (error) throw new Error(await getFunctionErrorMessage(error, response));
  return data;
}

export async function getSmtpSettings() {
  const data = await callMailAdmin<{ settings: SmtpSettings | null }>({ action: "get-settings" });
  return data?.settings ?? null;
}

export async function saveSmtpSettings(draft: SmtpSettingsDraft) {
  const data = await callMailAdmin<{ settings: SmtpSettings }>({ action: "save-settings", ...draft });
  if (!data?.settings) throw new Error("Сервер не вернул сохранённые настройки");
  return data.settings;
}

export async function queueTestEmail(recipientEmail: string) {
  const data = await callMailAdmin<QueueMailResult>({ action: "queue-test", recipientEmail });
  if (!data) throw new Error("Сервер не вернул идентификатор тестовой отправки");
  return data;
}

export async function queueFormReminders(formId: string) {
  const data = await callMailAdmin<QueueMailResult>({ action: "queue-reminders", formId });
  if (!data) throw new Error("Сервер не вернул результат постановки писем в очередь");
  return data;
}

const BATCH_SELECT = "id, kind, form_id, created_by, total_count, created_at";
const JOB_SELECT = "id, batch_id, form_id, organization_id, recipient_email, recipient_name, status, attempts, max_attempts, last_error, sent_at, created_at, updated_at";

export async function getFormMailActivity(formId: string): Promise<MailActivity> {
  const { data: batchesData, error: batchesError } = await runRequest(
    "mail.activity.batches",
    (signal) => apiClient.from("mail_batches").select(BATCH_SELECT).eq("form_id", formId).order("created_at", { ascending: false }).limit(20).abortSignal(signal),
    { context: { formId } },
  );
  if (batchesError) throw batchesError;
  const batches = (batchesData ?? []) as MailBatch[];
  return { batches, jobs: [] };
}

export async function getMailJobs(batchId: string): Promise<MailJob[]> {
  const pageSize = 1000;
  const jobs: MailJob[] = [];

  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await runRequest(
      "mail.batch.jobs",
      (signal) => apiClient
        .from("mail_queue")
        .select(JOB_SELECT)
        .eq("batch_id", batchId)
        .order("created_at")
        .order("id")
        .range(offset, offset + pageSize - 1)
        .abortSignal(signal),
      { context: { batchId, offset } },
    );
    if (error) throw error;
    const page = (data ?? []) as MailJob[];
    jobs.push(...page);
    if (page.length < pageSize) return jobs;
  }
}

export async function getMailBatchActivity(batchId: string): Promise<MailActivity> {
  const [{ data: batchData, error: batchError }, jobs] = await Promise.all([
    runRequest(
      "mail.batch.load",
      (signal) => apiClient.from("mail_batches").select(BATCH_SELECT).eq("id", batchId).abortSignal(signal).maybeSingle(),
      { context: { batchId } },
    ),
    getMailJobs(batchId),
  ]);
  if (batchError) throw batchError;
  return {
    batches: batchData ? [batchData as MailBatch] : [],
    jobs,
  };
}
