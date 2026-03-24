import { supabase } from "../../shared/api/supabase";
import type { SurveyResponse } from "./types";

export async function createResponse(formId: string, data: Record<string, unknown>) {
  const { error } = await supabase.from("responses").insert({
    form_id: formId,
    data,
  });

  if (error) throw error;
}

export async function getResponsesByForm(formId: string): Promise<SurveyResponse[]> {
  const { data, error } = await supabase
    .from("responses")
    .select("*")
    .eq("form_id", formId)
    .order("created_at", { ascending: false });

  if (error) throw error;
  return (data ?? []) as SurveyResponse[];
}
