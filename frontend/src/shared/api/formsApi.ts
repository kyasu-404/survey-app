import { apiClient, publicApiClient } from "./client";
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

type RawForm = Omit<SurveyForm, "responses_count" | "author_email" | "author_name"> & {
  profiles?: { email?: string | null; name?: string | null } | null;
  responses_count?: number | null;
};

type RawFormSummary = Pick<
  SurveyFormSummary,
  "id" | "title" | "form_type" | "form_reason" | "is_public" | "author_id" | "created_at"
> &
  Partial<Pick<SurveyFormSummary, "deadline_at" | "max_responses">> & {
  profiles?: { email?: string | null; name?: string | null } | null;
  responses_count?: number | null;
};

type FetchFormsPageOptions = {
  page: number;
  pageSize: number;
  filters?: FormsFilters;
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
  created_at,
  responses_count,
  profiles:author_id!inner(email, name)
`;

const TEMPLATE_FORMS_SUMMARY_SELECT = `
  id,
  title,
  form_type,
  form_reason,
  is_public,
  author_id,
  created_at,
  profiles:author_id!inner(email, name)
`;

const DASHBOARD_FORMS_COUNT_SELECT = "id";
const DASHBOARD_FORMS_COUNT_WITH_PROFILE_SELECT = "id, profiles:author_id!inner(id)";

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

function mapRawForm(form: RawForm): SurveyForm {
  return {
    ...form,
    author_email: form.profiles?.email ?? null,
    author_name: form.profiles?.name ?? null,
    responses_count: form.responses_count ?? 0,
  };
}

function mapRawFormSummary(form: RawFormSummary): SurveyFormSummary {
  return {
    ...form,
    deadline_at: form.deadline_at ?? null,
    author_email: form.profiles?.email ?? null,
    author_name: form.profiles?.name ?? null,
    responses_count: form.responses_count ?? 0,
  };
}

function normalizeSearchValue(search: string) {
  return search.trim().replace(/[,()]/g, " ");
}

function getDashboardFormsCountSelect(filters?: FormsFilters) {
  return filters?.search ? DASHBOARD_FORMS_COUNT_WITH_PROFILE_SELECT : DASHBOARD_FORMS_COUNT_SELECT;
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
    query = query.or(
      `title.ilike.${wildcard},profiles.email.ilike.${wildcard},profiles.name.ilike.${wildcard}`,
    );
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

export async function fetchForms(filters?: FormsFilters): Promise<SurveyForm[]> {
  let query = apiClient
    .from("forms")
    .select("*, profiles:author_id(email, name)")
    .order("created_at", { ascending: false });

  if (filters?.search) query = query.ilike("title", `%${filters.search}%`);
  if (filters?.dateFrom) query = query.gte("created_at", filters.dateFrom);
  if (filters?.dateTo) query = query.lte("created_at", filters.dateTo);
  if (filters?.authorId) query = query.eq("author_id", filters.authorId);
  if (filters?.formType) query = query.eq("form_type", filters.formType);
  if (filters?.formReason) query = query.eq("form_reason", filters.formReason);
  if (typeof filters?.isPublic === "boolean") query = query.eq("is_public", filters.isPublic);

  const { data, error } = await runRequest(
    "forms.fetchList",
    () => query,
    { context: { authorId: filters?.authorId ?? null, hasSearch: Boolean(filters?.search) } },
  );
  if (error) throw error;

  const forms = ((data ?? []) as RawForm[]).map(mapRawForm);

  return forms.map((form) => syncFetchedDeadlineState(form));
}

export async function fetchDashboardFormsPage(
  options: FetchFormsPageOptions,
): Promise<PaginatedSurveyFormSummaries> {
  const rangeFrom = Math.max(options.page, 0) * options.pageSize;
  const rangeTo = rangeFrom + options.pageSize - 1;

  let query = apiClient
    .from("forms")
    .select(DASHBOARD_FORMS_SUMMARY_SELECT, { count: "exact" })
    .order("created_at", { ascending: false })
    .neq("form_type", TEMPLATE_FORM_TYPE);

  query = applyFormsFilters(query, options.filters);

  const { data, count, error } = await runRequest(
    "forms.fetchDashboardPage",
    () => query.range(rangeFrom, rangeTo),
    {
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
      .map((form) => syncFetchedDeadlineState(form)),
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
    .select(TEMPLATE_FORMS_SUMMARY_SELECT, { count: "exact" })
    .order("created_at", { ascending: false });

  query = applyFormsFilters(query, options.filters);

  const { data, count, error } = await runRequest(
    "forms.fetchTemplatePage",
    () => query.range(rangeFrom, rangeTo),
    {
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

export async function fetchDashboardFormsStats(filters?: FormsFilters): Promise<DashboardFormsStats> {
  let totalQuery = apiClient
    .from("forms")
    .select(getDashboardFormsCountSelect(filters), { count: "exact", head: true })
    .neq("form_type", TEMPLATE_FORM_TYPE);
  totalQuery = applyFormsFilters(totalQuery, filters);

  let activeQuery = apiClient
    .from("forms")
    .select(getDashboardFormsCountSelect(filters), { count: "exact", head: true })
    .neq("form_type", TEMPLATE_FORM_TYPE)
    .eq("is_public", true);
  activeQuery = applyFormsFilters(activeQuery, filters);

  let deadlineQuery = apiClient
    .from("forms")
    .select(getDashboardFormsCountSelect(filters), { count: "exact", head: true })
    .neq("form_type", TEMPLATE_FORM_TYPE)
    .not("deadline_at", "is", null);
  deadlineQuery = applyFormsFilters(deadlineQuery, filters);

  const [totalResult, activeResult, deadlineResult] = await Promise.all([
    runRequest("forms.fetchDashboardStats.total", () => totalQuery, {
      context: { authorId: filters?.authorId ?? null, hasSearch: Boolean(filters?.search) },
    }),
    runRequest("forms.fetchDashboardStats.active", () => activeQuery, {
      context: { authorId: filters?.authorId ?? null, hasSearch: Boolean(filters?.search) },
    }),
    runRequest("forms.fetchDashboardStats.deadline", () => deadlineQuery, {
      context: { authorId: filters?.authorId ?? null, hasSearch: Boolean(filters?.search) },
    }),
  ]);

  if (totalResult.error) {
    throw totalResult.error;
  }
  if (activeResult.error) {
    throw activeResult.error;
  }
  if (deadlineResult.error) {
    throw deadlineResult.error;
  }

  return {
    totalCount: totalResult.count ?? 0,
    activeCount: activeResult.count ?? 0,
    formsWithDeadlineCount: deadlineResult.count ?? 0,
  };
}

export async function fetchFormById(id: string): Promise<SurveyForm> {
  const { data, error } = await runRequest(
    "forms.fetchById",
    () => apiClient.from("forms").select("*").eq("id", id).single(),
    { context: { formId: id } },
  );
  if (error) throw error;
  return syncFetchedDeadlineState(data as SurveyForm);
}

export async function fetchPublicFormById(id: string): Promise<SurveyForm | null> {
  const { data, error } = await runRequest(
    "forms.fetchPublicById",
    () => publicApiClient.from("forms").select("*").eq("id", id).maybeSingle(),
    { context: { formId: id } },
  );
  if (error) throw error;

  if (!data) {
    return null;
  }

  return syncFetchedDeadlineState(data as SurveyForm);
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
  const { error } = await runRequest(
    "forms.updateTitle",
    () => apiClient.from("forms").update({ title }).eq("id", id),
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
  const { error } = await runRequest(
    "forms.updateStatus",
    () => apiClient.from("forms").update({ is_public: isPublic }).eq("id", id),
    { context: { formId: id, isPublic } },
  );
  if (error) throw error;
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
  const { error } = await runRequest(
    "forms.delete",
    () => apiClient.from("forms").delete().eq("id", id),
    { context: { formId: id } },
  );
  if (error) throw error;
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
