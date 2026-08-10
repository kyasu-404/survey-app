import { apiClient, supabaseClient } from "../../shared/api";
import { runRequest } from "../../shared/api/request";
import type { StorageCleanupOverview, StorageCleanupRun } from "./types";

type StorageCleanupAction =
  | { action: "get-cleanup-status" }
  | { action: "cleanup-orphans" };

async function getFunctionErrorMessage(error: unknown, response?: Response) {
  const errorResponse = response ?? (error instanceof Error && "context" in error ? error.context : undefined);
  if (errorResponse instanceof Response) {
    const payload = await errorResponse.clone().json().catch(() => null) as {
      error?: unknown;
      message?: unknown;
    } | null;
    const details = [payload?.error, payload?.message]
      .find((value): value is string => typeof value === "string" && Boolean(value.trim()))
      ?.trim();
    if (details) return details;
  }
  return error instanceof Error && error.message.trim()
    ? error.message
    : "Не удалось выполнить очистку файлов";
}

async function callFormAdmin<T>(payload: StorageCleanupAction, timeoutMs = 30_000) {
  const { data: { session } } = await runRequest("auth.getSession", () => apiClient.auth.getCurrentSession());
  if (!session?.access_token) throw new Error("Сессия авторизации не готова. Попробуйте обновить страницу.");

  const { data, error, response } = await runRequest(
    `functions.form-admin.${payload.action}`,
    (_signal, traceContext) => supabaseClient.functions.invoke<T>("form-admin", {
      body: payload,
      headers: { ...traceContext.headers, Authorization: `Bearer ${session.access_token}` },
    }),
    { context: { action: payload.action }, timeoutMs },
  );
  if (error) throw new Error(await getFunctionErrorMessage(error, response));
  if (!data) throw new Error("Сервер не вернул результат очистки");
  return data;
}

export function getStorageCleanupOverview() {
  return callFormAdmin<StorageCleanupOverview>({ action: "get-cleanup-status" });
}

export async function runStorageCleanup() {
  const data = await callFormAdmin<{ success: boolean; run: StorageCleanupRun }>(
    { action: "cleanup-orphans" },
    60_000,
  );
  if (!data.success || !data.run) throw new Error("Сервер не подтвердил завершение очистки");
  return data.run;
}
