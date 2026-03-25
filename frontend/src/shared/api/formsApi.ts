import { apiClient } from "./client";
import type { SurveyForm, SurveySchema } from "../../entities/survey/types";

export type FormsFilters = {
  search?: string;
  dateFrom?: string;
  dateTo?: string;
};

type RawForm = Omit<SurveyForm, "responses_count" | "author_email"> & {
  profiles?: { email?: string | null } | null;
  responses?: Array<{ count?: number | null }> | null;
};

export async function fetchForms(filters?: FormsFilters): Promise<SurveyForm[]> {
  let query = apiClient
    .from("forms")
    .select("*, profiles:author_id(email), responses(count)")
    .order("created_at", { ascending: false });

  if (filters?.search) query = query.ilike("title", `%${filters.search}%`);
  if (filters?.dateFrom) query = query.gte("created_at", filters.dateFrom);
  if (filters?.dateTo) query = query.lte("created_at", filters.dateTo);

  const { data, error } = await query;
  if (error) throw error;

  return ((data ?? []) as RawForm[]).map((form) => ({
    ...form,
    author_email: form.profiles?.email ?? null,
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
  const { data, error } = await apiClient
    .from("forms")
    .insert({
      title: payload.title,
      form_type: payload.formType,
      form_reason: payload.formReason,
      schema: payload.schema,
      author_id: payload.authorId,
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

export async function deleteForm(id: string) {
  const { error } = await apiClient.from("forms").delete().eq("id", id);
  if (error) throw error;
}

export async function duplicateForm(form: SurveyForm, authorId: string) {
  const title = `${form.title} (копия)`;

  const { data, error } = await apiClient
    .from("forms")
    .insert({
      title,
      form_type: form.form_type,
      form_reason: form.form_reason,
      schema: form.schema,
      author_id: authorId,
    })
    .select("id")
    .single();

  if (error) throw error;
  return data;
}
