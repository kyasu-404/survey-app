import type {
  ExistingResponseResult,
  SubmitResponseResult,
  SurveyResponse,
  UpdateResponseResult,
} from "./types";
import { apiClient, publicApiClient, supabaseClient } from "../../shared/api/client";
import { runRequest } from "../../shared/api/request";
import { timelineBefore, type TimelineCursor } from "../../shared/api/timelinePage";

export const RESPONSES_PAGE_SIZE = 50;
export const MAX_CLIENT_RESPONSE_EXPORT = 10_000;
const MIN_RESPONSES_PAGE_SIZE = 1;
const MAX_RESPONSES_PAGE_SIZE = 100;
const PAGINATED_COUNT_MODE = "exact";
const SAFE_RESPONSE_LIST_COLUMNS = "id, form_id, data, created_at, updated_at";

export type FetchResponsesByFormOptions = {
  page?: number;
  pageSize?: number;
  signal?: AbortSignal;
};

export type PaginatedResponses = {
  data: SurveyResponse[];
  count: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

type SubmitResponseRpcRow = {
  status?: unknown;
  response_id?: unknown;
  response_data?: unknown;
  response_editable?: unknown;
};

type UpdateResponseRpcRow = {
  response_id?: unknown;
  response_data?: unknown;
};

type ExistingResponseRpcRow = {
  response_id?: unknown;
  response_data?: unknown;
  response_editable?: unknown;
};

function normalizePositiveInteger(value: number | undefined, fallback: number) {
  if (!Number.isFinite(value) || !value) {
    return fallback;
  }

  return Math.max(1, Math.floor(value));
}

function normalizePageSize(pageSize: number | undefined) {
  const normalizedPageSize = normalizePositiveInteger(pageSize, RESPONSES_PAGE_SIZE);
  return Math.min(MAX_RESPONSES_PAGE_SIZE, Math.max(MIN_RESPONSES_PAGE_SIZE, normalizedPageSize));
}

function applyAbortSignal<TQuery>(query: TQuery, signal?: AbortSignal): TQuery {
  if (!signal) {
    return query;
  }

  const abortableQuery = query as TQuery & {
    abortSignal?: (signal: AbortSignal) => TQuery;
  };

  return typeof abortableQuery.abortSignal === "function" ? abortableQuery.abortSignal(signal) : query;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function getFirstRpcRow(value: unknown) {
  return Array.isArray(value) ? value[0] : value;
}

function mapSubmitResponseResult(value: unknown): SubmitResponseResult {
  const row = getFirstRpcRow(value) as SubmitResponseRpcRow | null;
  const status = row?.status;

  if (
    (status !== "submitted" && status !== "already_submitted")
    || typeof row?.response_id !== "string"
    || !isRecord(row.response_data)
  ) {
    throw new Error("Сервер вернул некорректный результат сохранения ответа");
  }

  return {
    status,
    responseId: row.response_id,
    data: row.response_data,
    editable: row.response_editable === true,
  };
}

function mapUpdateResponseResult(value: unknown): UpdateResponseResult {
  const row = getFirstRpcRow(value) as UpdateResponseRpcRow | null;

  if (typeof row?.response_id !== "string" || !isRecord(row.response_data)) {
    throw new Error("Сервер вернул некорректный результат редактирования ответа");
  }

  return {
    responseId: row.response_id,
    data: row.response_data,
  };
}

function mapExistingResponseResult(value: unknown): ExistingResponseResult | null {
  const row = getFirstRpcRow(value) as ExistingResponseRpcRow | null;

  if (!row) {
    return null;
  }

  if (typeof row.response_id !== "string" || !isRecord(row.response_data)) {
    throw new Error("Сервер вернул некорректный статус ответа");
  }

  return {
    responseId: row.response_id,
    data: row.response_data,
    editable: row.response_editable === true,
  };
}

async function getFunctionErrorMessage(error: unknown, response?: Response) {
  const errorResponse = response ?? (error instanceof Error && "context" in error ? error.context : undefined);

  if (errorResponse instanceof Response) {
    const payload: unknown = await errorResponse.clone().json().catch(() => null);
    if (isRecord(payload) && typeof payload.error === "string" && payload.error.trim()) {
      return payload.error.trim();
    }
  }

  return error instanceof Error && error.message.trim() ? error.message : "Не удалось удалить ответы";
}

export async function insertResponse(
  formId: string,
  data: Record<string, unknown>,
  submissionId: string,
  browserId: string,
  signal?: AbortSignal,
  personalToken?: string,
  usePublicClient = false,
): Promise<SubmitResponseResult> {
  const client = usePublicClient || Boolean(personalToken) ? publicApiClient : apiClient;
  const { data: result, error } = await runRequest(
    "responses.submit",
    (requestSignal) => applyAbortSignal(
      client.rpc(personalToken ? "submit_personal_form_response" : "submit_form_response", {
        p_form_id: formId,
        ...(personalToken ? { p_token: personalToken } : { p_browser_id: browserId }),
        p_submission_id: submissionId,
        p_data: data,
      }),
      requestSignal,
    ),
    { signal, context: { formId, submissionId } },
  );

  if (error) throw error;
  return mapSubmitResponseResult(result);
}

export async function fetchExistingResponse(
  formId: string,
  browserId: string,
  signal?: AbortSignal,
  personalToken?: string,
  usePublicClient = false,
): Promise<ExistingResponseResult | null> {
  const client = usePublicClient || Boolean(personalToken) ? publicApiClient : apiClient;
  const { data: result, error } = await runRequest(
    "responses.fetchExisting",
    (requestSignal) => applyAbortSignal(
      client.rpc(personalToken ? "get_personal_form_response_status" : "get_form_response_status", {
        p_form_id: formId,
        ...(personalToken ? { p_token: personalToken } : { p_browser_id: browserId }),
      }),
      requestSignal,
    ),
    { signal, context: { formId } },
  );

  if (error) throw error;
  return mapExistingResponseResult(result);
}

export async function updateResponse(
  formId: string,
  responseId: string,
  data: Record<string, unknown>,
  browserId: string,
  signal?: AbortSignal,
  personalToken?: string,
  usePublicClient = false,
): Promise<UpdateResponseResult> {
  const client = usePublicClient || Boolean(personalToken) ? publicApiClient : apiClient;
  const { data: result, error } = await runRequest(
    "responses.update",
    (requestSignal) => applyAbortSignal(
      client.rpc(personalToken ? "update_personal_form_response" : "update_form_response", {
        p_form_id: formId,
        ...(personalToken ? { p_token: personalToken } : { p_browser_id: browserId }),
        p_response_id: responseId,
        p_data: data,
      }),
      requestSignal,
    ),
    { signal, context: { formId, responseId } },
  );

  if (error) throw error;
  return mapUpdateResponseResult(result);
}

export async function deleteResponses(formId: string, responseIds: string[]) {
  const {
    data: { session },
  } = await runRequest("auth.getSession", () => apiClient.auth.getCurrentSession(), { context: { formId } });
  const accessToken = session?.access_token;

  if (!accessToken) {
    throw new Error("Сессия авторизации не готова. Попробуйте обновить страницу.");
  }

  const { error, response } = await runRequest(
    "functions.form-admin.deleteResponses",
    (signal, traceContext) => supabaseClient.functions.invoke("form-admin", {
      body: { action: "delete-responses", formId, responseIds },
      headers: {
        ...traceContext.headers,
        Authorization: `Bearer ${accessToken}`,
      },
      signal,
    }),
    { context: { formId, responseCount: responseIds.length } },
  );

  if (error) {
    throw new Error(await getFunctionErrorMessage(error, response));
  }
}

export async function fetchResponsesByForm(
  formId: string,
  options: FetchResponsesByFormOptions = {},
): Promise<PaginatedResponses> {
  const page = normalizePositiveInteger(options.page, 1);
  const pageSize = normalizePageSize(options.pageSize);
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  const { data, error, count } = await runRequest(
    "responses.fetchByForm",
    (signal) => {
      const query = apiClient
        .from("responses")
        .select(SAFE_RESPONSE_LIST_COLUMNS, { count: PAGINATED_COUNT_MODE })
        .eq("form_id", formId);

      const orderedQuery = query
        .order("created_at", { ascending: false })
        .order("id", { ascending: false });

      return applyAbortSignal(orderedQuery, signal).range(from, to);
    },
    {
      signal: options.signal,
      context: {
        formId,
        page,
        pageSize,
      },
    },
  );

  if (error && typeof error === "object" && "code" in error && error.code === "PGRST103" && page > 1) {
    // Deletion can invalidate an offset before PostgREST returns a usable count.
    return fetchResponsesByForm(formId, { ...options, page: 1 });
  }
  if (error) throw error;
  if (typeof count !== "number") {
    throw new Error("Сервер не вернул точное количество ответов");
  }
  const responses = (data ?? []) as SurveyResponse[];
  const totalCount = count;

  return {
    data: responses,
    count: totalCount,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(totalCount / pageSize)),
  };
}

export async function fetchResponsesForSorting(formId: string, signal?: AbortSignal): Promise<SurveyResponse[]> {
  try {
    // The server checks size and returns all rows from one database snapshot.
    const responses = await fetchAllResponsesByForm(formId, { signal });
    signal?.throwIfAborted();
    return responses;
  } catch (error) {
    signal?.throwIfAborted();
    if (isRecord(error) && error.code === "54000") {
      throw new Error("Сортировка доступна для форм с количеством ответов до 10 000 и общим объёмом до 32 МБ");
    }
    throw error;
  }
}

/** Resolve chronological numbers without downloading answers outside the selection. */
export async function fetchSelectedResponseNumbers(formId: string, responseIds: ReadonlySet<string>, signal?: AbortSignal) {
  const remaining = new Set(responseIds);
  const selected: Array<{ id: string; number: number }> = [];
  let number = 0;
  let cursor: TimelineCursor | undefined;

  while (remaining.size > 0) {
    signal?.throwIfAborted();
    const { data, error } = await runRequest("responses.numberSelection", (requestSignal) => {
      const query = apiClient.from("responses").select("id, created_at").eq("form_id", formId);
      if (cursor) query.or(timelineBefore(cursor));
      return applyAbortSignal(query.order("created_at", { ascending: false }).order("id", { ascending: false }), requestSignal)
        .limit(1000);
    }, { signal, context: { formId } });

    signal?.throwIfAborted();
    if (error) throw error;
    const batch = data as TimelineCursor[] | null;
    if (!batch?.length) break;
    for (const { id } of batch) {
      number += 1;
      if (remaining.delete(id)) selected.push({ id, number });
    }
    cursor = batch[batch.length - 1];
  }
  return selected;
}

export async function fetchAllResponsesByForm(
  formId: string,
  options: { signal?: AbortSignal; responseIds?: string[] } = {},
): Promise<SurveyResponse[]> {
  options.signal?.throwIfAborted();
  const { data, error } = await runRequest(
    "responses.exportSnapshot",
    (signal) => applyAbortSignal(apiClient.rpc("export_form_responses", {
      p_form_id: formId,
      p_response_ids: options.responseIds ?? null,
    }), signal),
    { signal: options.signal, timeoutMs: 60_000, context: { formId } },
  );
  if (error) throw error;
  if (!Array.isArray(data)) throw new Error("Сервер не вернул снимок ответов");
  return data as SurveyResponse[];
}
