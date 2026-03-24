import { apiClient } from "./client";
import type { SurveyForm, SurveySchema } from "../../entities/survey/types";

export type FormsFilters = {
  search?: string;
  dateFrom?: string;
  dateTo?: string;
};

export async function fetchForms(filters?: FormsFilters): Promise<SurveyForm[]> {
  let query = apiClient.from("forms").select("*").order("created_at", { ascending: false });

  if (filters?.search) query = query.ilike("title", `%${filters.search}%`);
  if (filters?.dateFrom) query = query.gte("created_at", filters.dateFrom);
  if (filters?.dateTo) query = query.lte("created_at", filters.dateTo);

  const { data, error } = await query;
  if (error) throw error;

  return (data ?? []) as SurveyForm[];
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
