import { apiClient } from "./client";
import type { SurveyForm, SurveySchema } from "../../entities/survey/types";

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

async function getAuthenticatedUserId(): Promise<string> {
  const {
    data: { user },
    error,
  } = await apiClient.auth.getCurrentUser();

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

  const { data, error } = await query;
  if (error) throw error;

  return ((data ?? []) as RawForm[]).map((form) => ({
    ...form,
    author_email: form.profiles?.email ?? null,
    author_name: form.profiles?.name ?? null,
    responses_count: form.responses?.[0]?.count ?? 0,
  }));
}

export async function fetchFormById(id: string): Promise<SurveyForm> {
  const { data, error } = await apiClient.from("forms").select("*").eq("id", id).single();
  if (error) throw error;
  return data as SurveyForm;
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

  const { data, error } = await apiClient
    .from("forms")
    .insert({
      title: payload.title,
      form_type: payload.formType,
      form_reason: payload.formReason,
      schema: payload.schema,
      author_id: currentUserId,
    })
    .select("id")
    .single();

  if (error) throw error;
  return data;
}

export async function updateFormTitle(id: string, title: string) {
  const { error } = await apiClient.from("forms").update({ title }).eq("id", id);
  if (error) throw error;
}

export async function updateFormSchema(id: string, schema: SurveySchema, title: string) {
  const { error } = await apiClient.from("forms").update({ schema, title }).eq("id", id);
  if (error) throw error;
}

export async function updateFormStatus(id: string, isPublic: boolean) {
  const { error } = await apiClient.from("forms").update({ is_public: isPublic }).eq("id", id);
  if (error) throw error;
}

export async function updateFormDeadline(id: string, deadlineAt: string | null) {
  const { error } = await apiClient.from("forms").update({ deadline_at: deadlineAt }).eq("id", id);
  if (error) throw error;
}

export async function deleteForm(id: string) {
  const { error } = await apiClient.from("forms").delete().eq("id", id);
  if (error) throw error;
}

export async function duplicateForm(form: SurveyForm, authorId: string) {
  const currentUserId = await getAuthenticatedUserId();

  if (authorId !== currentUserId) {
    throw new Error("author_id должен совпадать с текущим пользователем");
  }

  const title = `${form.title} (копия)`;

  const { data, error } = await apiClient
    .from("forms")
    .insert({
      title,
      form_type: form.form_type,
      form_reason: form.form_reason,
      schema: form.schema,
      author_id: currentUserId,
    })
    .select("id")
    .single();

  if (error) throw error;
  return data;
}
