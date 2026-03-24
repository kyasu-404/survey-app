import { supabase } from "../../../shared/api/supabase";
import type { SurveyForm, SurveySchema } from "../types";

export type FormsFilters = {
  search?: string;
  dateFrom?: string;
  dateTo?: string;
};

export async function getForms(filters?: FormsFilters): Promise<SurveyForm[]> {
  let query = supabase.from("forms").select("*").order("created_at", { ascending: false });

  if (filters?.search) query = query.ilike("title", `%${filters.search}%`);
  if (filters?.dateFrom) query = query.gte("created_at", filters.dateFrom);
  if (filters?.dateTo) query = query.lte("created_at", filters.dateTo);

  const { data, error } = await query;
  if (error) throw error;

  return (data ?? []) as SurveyForm[];
}

export async function getFormById(id: string): Promise<SurveyForm> {
  const { data, error } = await supabase.from("forms").select("*").eq("id", id).single();
  if (error) throw error;
  return data as SurveyForm;
}

export async function createSurvey(params: {
  title: string;
  formType: string;
  formReason: string;
  schema: SurveySchema;
  authorId: string;
}) {
  const { data, error } = await supabase
    .from("forms")
    .insert({
      title: params.title,
      form_type: params.formType,
      form_reason: params.formReason,
      schema: params.schema,
      author_id: params.authorId,
    })
    .select("id")
    .single();

  if (error) throw error;
  return data;
}
