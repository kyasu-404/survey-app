import { apiClient } from "./client";
import type { SurveyResponse } from "../../entities/response/types";
import { runRequest } from "./request";

export const RESPONSES_PAGE_SIZE = 50;
const MIN_RESPONSES_PAGE_SIZE = 1;
const MAX_RESPONSES_PAGE_SIZE = 100;
const PAGINATED_COUNT_MODE = "exact";

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

export async function insertResponse(formId: string, data: Record<string, unknown>) {
  const { error } = await runRequest(
    "responses.insert",
    () =>
      apiClient.from("responses").insert({
        form_id: formId,
        data,
      }),
    { context: { formId } },
  );

  if (error) throw error;
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
    (signal) =>
      applyAbortSignal(
        apiClient
          .from("responses")
          .select("*", { count: PAGINATED_COUNT_MODE })
          .eq("form_id", formId)
          .order("created_at", { ascending: false })
          .order("id", { ascending: false }),
        signal,
      ).range(from, to),
    { signal: options.signal, context: { formId, page, pageSize } },
  );

  if (error) throw error;
  const responses = (data ?? []) as SurveyResponse[];
  const totalCount = count ?? responses.length;

  return {
    data: responses,
    count: totalCount,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(totalCount / pageSize)),
  };
}
