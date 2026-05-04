import { apiClient, publicApiClient, supabaseClient } from "./client";
import { applyDeadlineStatePatch, buildDeadlineUpdatePayload, getDeadlineStatePatch } from "../../entities/survey/model/deadlineState";
import { TEMPLATE_FORM_TYPE } from "../../entities/survey/model/surveyModel";
import type {
  DashboardFormsStats,
  PaginatedSurveyFormSummaries,
  SurveyForm,
  SurveyFormSummary,
  SurveySchema,
} from "../../entities/survey/types";
import { runRequest } from "./request";

export type FormsFilters = {
  search?: string;
  dateFrom?: string;
  dateTo?: string;
  authorId?: string;
  formType?: string;
  formReason?: string;
  isPublic?: boolean;
};

type RawForm = Omit<SurveyForm, "responses_count" | "author_email"> & {
  responses_count?: number | null;
};

type RawFormSummary = Pick<
  SurveyFormSummary,
  "id" | "title" | "form_type" | "form_reason" | "is_public" | "author_id" | "author_name" | "created_at"
> &
  Partial<Pick<SurveyFormSummary, "deadline_at" | "max_responses">> & {
  responses_count?: number | null;
};

type RawDashboardFormsStats = {
  total_count?: number | string | null;
  active_count?: number | string | null;
  forms_with_deadline_count?: number | string | null;
};

type FetchFormsPageOptions = {
  page: number;
  pageSize: number;
  filters?: FormsFilters;
  signal?: AbortSignal;
};

type RequestSignalOptions = {
  signal?: AbortSignal;
};

const DASHBOARD_FORMS_SUMMARY_SELECT = `
  id,
  title,
  form_type,
  form_reason,
  is_public,
  deadline_at,
  max_responses,
  author_id,
  author_name,
  created_at,
  responses_count
`;

const TEMPLATE_FORMS_SUMMARY_SELECT = `
  id,
  title,
  form_type,
  form_reason,
  is_public,
  author_id,
  author_name,
  created_at
`;

const PAGINATED_COUNT_MODE = "planned";
const DASHBOARD_FORMS_STATS_RPC = "get_dashboard_forms_stats";

async function getFunctionErrorMessage(error: unknown, response?: Response): Promise<string> {
  const errorResponse = response ?? (error instanceof Error && "context" in error ? error.context : undefined);

  if (errorResponse instanceof Response) {
    const contentType = errorResponse.headers.get("Content-Type") ?? "";

    if (contentType.includes("application/json")) {
      const payload: unknown = await errorResponse
        .clone()
        .json()
        .catch((): null => null);
      const message =
        typeof payload === "object" &&
        payload !== null &&
        "error" in payload &&
        typeof payload.error === "string"
          ? payload.error.trim()
          : "";

      if (message) {
        return message;
      }
    }
  }

  return error instanceof Error && error.message.trim() ? error.message : "Не удалось удалить форму";
}

function resolveInitialPublicationState(formType: string, isPublic?: boolean) {
  if (typeof isPublic === "boolean") {
    return isPublic;
  }

  return formType === "template" ? false : true;
}

function normalizeMaxResponses(maxResponses?: number | null) {
  return typeof maxResponses === "number" && Number.isFinite(maxResponses)
    ? Math.max(1, Math.trunc(maxResponses))
    : null;
}

function syncFetchedDeadlineState<T extends Pick<SurveyForm, "deadline_at" | "form_type" | "is_public">>(form: T): T {
  const deadlineStatePatch = getDeadlineStatePatch(form);

  if (!deadlineStatePatch) {
    return form;
  }

  return applyDeadlineStatePatch(form, deadlineStatePatch);
}

function syncFetchedResponseLimitState<
  T extends Pick<SurveyForm, "is_public"> & Partial<Pick<SurveyForm, "max_responses" | "responses_count">>,
>(form: T): T {
  const maxResponses = form.max_responses;
  const responsesCount = form.responses_count ?? 0;

  if (typeof maxResponses === "number" && maxResponses > 0 && responsesCount >= maxResponses) {
    return {
      ...form,
      is_public: false,
    };
  }

  return form;
}

function syncFetchedFormState<
  T extends Pick<SurveyForm, "deadline_at" | "form_type" | "is_public"> &
    Partial<Pick<SurveyForm, "max_responses" | "responses_count">>,
>(form: T): T {
  return syncFetchedResponseLimitState(syncFetchedDeadlineState(form));
}

function mapRawForm(form: RawForm): SurveyForm {
  return {
    ...form,
    author_email: null,
    author_name: form.author_name ?? null,
    responses_count: form.responses_count ?? 0,
  };
}

function mapRawFormSummary(form: RawFormSummary): SurveyFormSummary {
  return {
    ...form,
    deadline_at: form.deadline_at ?? null,
    author_email: null,
    author_name: form.author_name ?? null,
    responses_count: form.responses_count ?? 0,
  };
}

function normalizeSearchValue(search: string) {
  return search.trim().replace(/[,()]/g, " ");
}

function toCount(value: number | string | null | undefined) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  return 0;
}

function buildDashboardStatsParams(filters?: FormsFilters) {
  const search = filters?.search ? normalizeSearchValue(filters.search) : "";

  return {
    p_author_id: filters?.authorId ?? null,
    p_date_from: filters?.dateFrom ?? null,
    p_date_to: filters?.dateTo ?? null,
    p_form_reason: filters?.formReason ?? null,
    p_form_type: filters?.formType ?? null,
    p_is_public: filters?.isPublic ?? null,
    p_search: search || null,
  };
}

function applyFormsFilters<TQuery extends {
  or: (filter: string) => TQuery;
  gte: (column: string, value: string) => TQuery;
  lte: (column: string, value: string) => TQuery;
  eq: (column: string, value: string | boolean) => TQuery;
}>(query: TQuery, filters?: FormsFilters) {
  const normalizedSearch = filters?.search ? normalizeSearchValue(filters.search) : "";

  if (normalizedSearch) {
    const wildcard = `%${normalizedSearch}%`;
    query = query.or(`title.ilike.${wildcard},author_name.ilike.${wildcard}`);
  }

  if (filters?.dateFrom) {
    query = query.gte("created_at", filters.dateFrom);
  }

  if (filters?.dateTo) {
    query = query.lte("created_at", filters.dateTo);
  }

  if (filters?.authorId) {
    query = query.eq("author_id", filters.authorId);
  }

  if (filters?.formType) {
    query = query.eq("form_type", filters.formType);
  }

  if (filters?.formReason) {
    query = query.eq("form_reason", filters.formReason);
  }

  if (typeof filters?.isPublic === "boolean") {
    query = query.eq("is_public", filters.isPublic);
  }

  return query;
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

async function getAuthenticatedUserId(): Promise<string> {
  const {
    data: { user },
    error,
  } = await runRequest("auth.getCurrentUser", () => apiClient.auth.getCurrentUser());

  if (error) {
    throw error;
  }

  if (!user?.id) {
    throw new Error("Пользователь не авторизован");
  }

  return user.id;
}

export async function fetchForms(filters?: FormsFilters, options: RequestSignalOptions = {}): Promise<SurveyForm[]> {
  let query = apiClient
    .from("forms")
    .select("*")
    .order("created_at", { ascending: false })
    .order("id", { ascending: false });
  query = applyFormsFilters(query, filters);

  const { data, error } = await runRequest(
    "forms.fetchList",
    (signal) => applyAbortSignal(query, signal),
    {
      signal: options.signal,
      context: { authorId: filters?.authorId ?? null, hasSearch: Boolean(filters?.search) },
    },
  );
  if (error) throw error;

  const forms = ((data ?? []) as RawForm[]).map(mapRawForm);

  return forms.map((form) => syncFetchedFormState(form));
}

export async function fetchDashboardFormsPage(
  options: FetchFormsPageOptions,
): Promise<PaginatedSurveyFormSummaries> {
  const rangeFrom = Math.max(options.page, 0) * options.pageSize;
  const rangeTo = rangeFrom + options.pageSize - 1;

  let query = apiClient
    .from("forms")
    .select(DASHBOARD_FORMS_SUMMARY_SELECT, { count: PAGINATED_COUNT_MODE })
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .neq("form_type", TEMPLATE_FORM_TYPE);

  query = applyFormsFilters(query, options.filters);

  const { data, count, error } = await runRequest(
    "forms.fetchDashboardPage",
    (signal) => applyAbortSignal(query, signal).range(rangeFrom, rangeTo),
    {
      signal: options.signal,
      context: {
        authorId: options.filters?.authorId ?? null,
        hasSearch: Boolean(options.filters?.search),
        page: options.page,
        pageSize: options.pageSize,
      },
    },
  );
  if (error) {
    throw error;
  }

  return {
    items: ((data ?? []) as RawFormSummary[])
      .map(mapRawFormSummary)
      .map((form) => syncFetchedFormState(form)),
    totalCount: count ?? 0,
  };
}

export async function fetchTemplateFormsPage(
  options: FetchFormsPageOptions,
): Promise<PaginatedSurveyFormSummaries> {
  const rangeFrom = Math.max(options.page, 0) * options.pageSize;
  const rangeTo = rangeFrom + options.pageSize - 1;

  let query = apiClient
    .from("forms")
    .select(TEMPLATE_FORMS_SUMMARY_SELECT, { count: PAGINATED_COUNT_MODE })
    .order("created_at", { ascending: false })
    .order("id", { ascending: false });

  query = applyFormsFilters(query, options.filters);

  const { data, count, error } = await runRequest(
    "forms.fetchTemplatePage",
    (signal) => applyAbortSignal(query, signal).range(rangeFrom, rangeTo),
    {
      signal: options.signal,
      context: {
        authorId: options.filters?.authorId ?? null,
        isPublic: options.filters?.isPublic ?? null,
        page: options.page,
        pageSize: options.pageSize,
      },
    },
  );
  if (error) {
    throw error;
  }

  return {
    items: ((data ?? []) as RawFormSummary[]).map(mapRawFormSummary),
    totalCount: count ?? 0,
  };
}

export async function fetchDashboardFormsStats(
  filters?: FormsFilters,
  options: RequestSignalOptions = {},
): Promise<DashboardFormsStats> {
  const { data, error } = await runRequest<{
    data: RawDashboardFormsStats[] | null;
    error: unknown | null;
  }>(
    "forms.fetchDashboardStats",
    (signal) => applyAbortSignal(apiClient.rpc(DASHBOARD_FORMS_STATS_RPC, buildDashboardStatsParams(filters)), signal),
    {
      signal: options.signal,
      context: { authorId: filters?.authorId ?? null, hasSearch: Boolean(filters?.search) },
    },
  );

  if (error) {
    throw error;
  }

  const stats = data?.[0];

  return {
    totalCount: toCount(stats?.total_count),
    activeCount: toCount(stats?.active_count),
    formsWithDeadlineCount: toCount(stats?.forms_with_deadline_count),
  };
}

export async function fetchFormById(id: string, options: RequestSignalOptions = {}): Promise<SurveyForm> {
  const { data, error } = await runRequest(
    "forms.fetchById",
    (signal) => applyAbortSignal(apiClient.from("forms").select("*").eq("id", id), signal).single(),
    { signal: options.signal, context: { formId: id } },
  );
  if (error) throw error;
  return syncFetchedFormState(data as SurveyForm);
}

export async function fetchPublicFormById(id: string, options: RequestSignalOptions = {}): Promise<SurveyForm | null> {
  const { data, error } = await runRequest(
    "forms.fetchPublicById",
    (signal) => applyAbortSignal(publicApiClient.from("forms").select("*").eq("id", id), signal).maybeSingle(),
    { signal: options.signal, context: { formId: id } },
  );
  if (error) throw error;

  if (!data) {
    return null;
  }

  return syncFetchedFormState(data as SurveyForm);
}

export async function insertForm(payload: {
  title: string;
  formType: string;
  formReason: string;
  schema: SurveySchema;
  authorId: string;
  deadlineAt?: string | null;
  maxResponses?: number | null;
  isPublic?: boolean;
}) {
  const currentUserId = await getAuthenticatedUserId();

  if (payload.authorId !== currentUserId) {
    throw new Error("author_id должен совпадать с текущим пользователем");
  }

  const normalizedMaxResponses = normalizeMaxResponses(payload.maxResponses);
  const deadlinePayload = buildDeadlineUpdatePayload(payload.deadlineAt ?? null);
  const initialPublicationState = resolveInitialPublicationState(payload.formType, payload.isPublic);
  const resolvedPublicationState = initialPublicationState && deadlinePayload.is_public !== false;

  const { data, error } = await runRequest(
    "forms.insert",
    () =>
      apiClient
        .from("forms")
        .insert({
          title: payload.title,
          form_type: payload.formType,
          form_reason: payload.formReason,
          schema: payload.schema,
          deadline_at: deadlinePayload.deadline_at ?? null,
          max_responses: normalizedMaxResponses,
          author_id: currentUserId,
          is_public: resolvedPublicationState,
        })
        .select("id")
        .single(),
    { context: { authorId: currentUserId, formType: payload.formType } },
  );

  if (error) throw error;
  return data;
}

export async function createFormFromTemplate(templateForm: SurveyForm, authorId: string) {
  const currentUserId = await getAuthenticatedUserId();

  if (authorId !== currentUserId) {
    throw new Error("author_id должен совпадать с текущим пользователем");
  }

  const schema: SurveySchema = {
    ...templateForm.schema,
    title: templateForm.title,
  };

  const { data, error } = await runRequest(
    "forms.createFromTemplate",
    () =>
      apiClient
        .from("forms")
        .insert({
          title: templateForm.title,
          form_type: "anketa",
          form_reason: "plan",
          schema,
          author_id: currentUserId,
          is_public: true,
        })
        .select("id")
        .single(),
    { context: { sourceTemplateId: templateForm.id, authorId: currentUserId } },
  );

  if (error) throw error;
  return data;
}

export async function updateFormTitle(id: string, title: string) {
  const { data: form, error: fetchError } = await runRequest(
    "forms.fetchSchemaForTitleUpdate",
    () => apiClient.from("forms").select("schema").eq("id", id).single(),
    { context: { formId: id } },
  );
  if (fetchError) throw fetchError;

  const currentSchema = ((form as { schema?: SurveySchema | null } | null)?.schema ?? { pages: [] }) as SurveySchema;
  const schema: SurveySchema = {
    ...currentSchema,
    title,
  };

  const { error } = await runRequest(
    "forms.updateTitle",
    () => apiClient.from("forms").update({ title, schema }).eq("id", id),
    { context: { formId: id } },
  );
  if (error) throw error;
}

export async function updateFormSchema(id: string, schema: SurveySchema, title: string) {
  const { error } = await runRequest(
    "forms.updateSchema",
    () => apiClient.from("forms").update({ schema, title }).eq("id", id),
    { context: { formId: id, pageCount: schema.pages.length } },
  );
  if (error) throw error;
}

export async function updateFormStatus(id: string, isPublic: boolean) {
  const statusPayload = isPublic
    ? { is_public: true, deadline_at: null }
    : { is_public: false, deadline_at: null };

  const { data, error } = await runRequest(
    "forms.updateStatus",
    () => apiClient.from("forms").update(statusPayload).eq("id", id).select("*").single(),
    { context: { formId: id, isPublic } },
  );
  if (error) throw error;

  const updatedForm = syncFetchedFormState(mapRawForm(data as RawForm));

  if (updatedForm.is_public !== isPublic) {
    throw new Error(
      isPublic
        ? "Форма осталась закрытой. Проверьте дедлайн или лимит ответов."
        : "Форма осталась открытой. Попробуйте обновить страницу.",
    );
  }

  return updatedForm;
}

export async function updateFormDeadline(id: string, deadlineAt: string | null) {
  const payload = buildDeadlineUpdatePayload(deadlineAt);
  const { error } = await runRequest(
    "forms.updateDeadline",
    () => apiClient.from("forms").update(payload).eq("id", id),
    {
      context: {
        formId: id,
        hasDeadline: Boolean(payload.deadline_at),
        isPublic: payload.is_public ?? null,
      },
    },
  );
  if (error) throw error;
}

export async function updateFormResponseLimit(id: string, maxResponses: number | null) {
  const normalizedLimit = normalizeMaxResponses(maxResponses);

  const { error } = await runRequest(
    "forms.updateResponseLimit",
    () => apiClient.from("forms").update({ max_responses: normalizedLimit }).eq("id", id),
    {
      context: {
        formId: id,
        maxResponses: normalizedLimit,
      },
    },
  );
  if (error) throw error;
}

export async function deleteForm(id: string) {
  const {
    data: { session },
  } = await runRequest("auth.getSession", () => apiClient.auth.getCurrentSession(), { context: { formId: id } });
  const accessToken = session?.access_token;

  if (!accessToken) {
    throw new Error("Сессия авторизации не готова. Попробуйте обновить страницу.");
  }

  const { error, response } = await runRequest(
    "functions.form-admin",
    (_signal, traceContext) =>
      supabaseClient.functions.invoke("form-admin", {
        body: { action: "delete", formId: id },
        headers: {
          ...traceContext.headers,
          Authorization: `Bearer ${accessToken}`,
        },
      }),
    { context: { formId: id, action: "delete" } },
  );

  if (error) {
    throw new Error(await getFunctionErrorMessage(error, response));
  }
}

export async function duplicateForm(form: SurveyForm, authorId: string) {
  const currentUserId = await getAuthenticatedUserId();

  if (authorId !== currentUserId) {
    throw new Error("author_id должен совпадать с текущим пользователем");
  }

  const title = `${form.title} (копия)`;

  const { data, error } = await runRequest(
    "forms.duplicate",
    () =>
      apiClient
        .from("forms")
        .insert({
          title,
          form_type: form.form_type,
          form_reason: form.form_reason,
          schema: form.schema,
          max_responses: form.max_responses ?? null,
          author_id: currentUserId,
        })
        .select("id")
        .single(),
    { context: { sourceFormId: form.id, authorId: currentUserId } },
  );

  if (error) throw error;
  return data;
}
