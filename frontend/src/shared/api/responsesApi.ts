import type {
  ExistingResponseResult,
  SubmitResponseResult,
  SurveyResponse,
  UpdateResponseResult,
} from "../../entities/response/types";
import { apiClient, supabaseClient } from "./client";
import { runRequest } from "./request";

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
): Promise<SubmitResponseResult> {
  const { data: result, error } = await runRequest(
    "responses.submit",
    (requestSignal) => applyAbortSignal(
      apiClient.rpc("submit_form_response", {
        p_form_id: formId,
        p_browser_id: browserId,
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
): Promise<ExistingResponseResult | null> {
  const { data: result, error } = await runRequest(
    "responses.fetchExisting",
    (requestSignal) => applyAbortSignal(
      apiClient.rpc("get_form_response_status", {
        p_form_id: formId,
        p_browser_id: browserId,
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
): Promise<UpdateResponseResult> {
  const { data: result, error } = await runRequest(
    "responses.update",
    (requestSignal) => applyAbortSignal(
      apiClient.rpc("update_form_response", {
        p_form_id: formId,
        p_browser_id: browserId,
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
    (_signal, traceContext) => supabaseClient.functions.invoke("form-admin", {
      body: { action: "delete-responses", formId, responseIds },
      headers: {
        ...traceContext.headers,
        Authorization: `Bearer ${accessToken}`,
      },
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

export async function fetchAllResponsesByForm(
  formId: string,
  options: Omit<FetchResponsesByFormOptions, "page" | "pageSize"> = {},
) {
  const pageSize = MAX_RESPONSES_PAGE_SIZE;
  const responses: SurveyResponse[] = [];
  let page = 1;

  for (;;) {
    options.signal?.throwIfAborted();
    const currentPage = await fetchResponsesByForm(formId, { ...options, page, pageSize });
    if (responses.length + currentPage.data.length > MAX_CLIENT_RESPONSE_EXPORT) {
      throw new Error(`В одной клиентской выгрузке поддерживается не более ${MAX_CLIENT_RESPONSE_EXPORT} ответов`);
    }
    responses.push(...currentPage.data);
    // Do not request an offset past the exact total: PostgREST can return 416
    // for that range, including when the last page contains exactly 100 rows.
    if (currentPage.data.length < pageSize || responses.length >= currentPage.count) return responses;
    page += 1;
  }
}
