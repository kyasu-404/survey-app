import { apiClient, publicApiClient } from "./client";
import { applyDeadlineStatePatch, buildDeadlineUpdatePayload, getDeadlineStatePatch } from "../../entities/survey/model/deadlineState";
import type { SurveyForm, SurveySchema } from "../../entities/survey/types";
import { runRequest } from "./request";

export type FormsFilters = {
  search?: string;
  dateFrom?: string;
  dateTo?: string;
  authorId?: string;
};

type RawForm = Omit<SurveyForm, "responses_count" | "author_email" | "author_name"> & {
  profiles?: { email?: string | null; name?: string | null } | null;
  responses?: Array<{ count?: number | null }> | null;
};

async function syncFetchedFormDeadlineState(form: SurveyForm, persistChanges = true): Promise<SurveyForm> {
  const deadlineStatePatch = getDeadlineStatePatch(form);

  if (!deadlineStatePatch) {
    return form;
  }

  if (persistChanges) {
    try {
      const { error } = await runRequest(
        "forms.syncDeadlineState",
        () => apiClient.from("forms").update(deadlineStatePatch).eq("id", form.id),
        {
          context: {
            formId: form.id,
            isPublic: deadlineStatePatch.is_public,
            hasDeadline: Boolean(deadlineStatePatch.deadline_at),
          },
        },
      );

      if (error) {
        throw error;
      }
    } catch (error) {
      console.error("Не удалось синхронизировать статус формы по дедлайну", error);
    }
  }

  return applyDeadlineStatePatch(form, deadlineStatePatch);
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
    .select("*, profiles:author_id(email, name), responses(count)")
    .order("created_at", { ascending: false });

  if (filters?.search) query = query.ilike("title", `%${filters.search}%`);
  if (filters?.dateFrom) query = query.gte("created_at", filters.dateFrom);
  if (filters?.dateTo) query = query.lte("created_at", filters.dateTo);
  if (filters?.authorId) query = query.eq("author_id", filters.authorId);

  const { data, error } = await runRequest(
    "forms.fetchList",
    () => query,
    { context: { authorId: filters?.authorId ?? null, hasSearch: Boolean(filters?.search) } },
  );
  if (error) throw error;

  const forms = ((data ?? []) as RawForm[]).map((form) => ({
    ...form,
    author_email: form.profiles?.email ?? null,
    author_name: form.profiles?.name ?? null,
    responses_count: form.responses?.[0]?.count ?? 0,
  }));

  return Promise.all(forms.map((form) => syncFetchedFormDeadlineState(form)));
}

export async function fetchFormById(id: string): Promise<SurveyForm> {
  const { data, error } = await runRequest(
    "forms.fetchById",
    () => apiClient.from("forms").select("*").eq("id", id).single(),
    { context: { formId: id } },
  );
  if (error) throw error;
  return syncFetchedFormDeadlineState(data as SurveyForm);
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

  return syncFetchedFormDeadlineState(data as SurveyForm, false);
}

export async function insertForm(payload: {
  title: string;
  formType: string;
  formReason: string;
  schema: SurveySchema;
  authorId: string;
}) {
  const currentUserId = await getAuthenticatedUserId();

  if (payload.authorId !== currentUserId) {
    throw new Error("author_id должен совпадать с текущим пользователем");
  }

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
          author_id: currentUserId,
        })
        .select("id")
        .single(),
    { context: { authorId: currentUserId, formType: payload.formType } },
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
          author_id: currentUserId,
        })
        .select("id")
        .single(),
    { context: { sourceFormId: form.id, authorId: currentUserId } },
  );

  if (error) throw error;
  return data;
}
