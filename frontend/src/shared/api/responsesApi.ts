import { apiClient } from "./client";
import type { SurveyResponse } from "../../entities/response/types";

export async function insertResponse(formId: string, data: Record<string, unknown>) {
  const { error } = await apiClient.from("responses").insert({
    form_id: formId,
    data,
  });

  if (error) throw error;
}

export async function fetchResponsesByForm(formId: string): Promise<SurveyResponse[]> {
  const { data, error } = await apiClient
    .from("responses")
    .select("*")
    .eq("form_id", formId)
    .order("created_at", { ascending: false });

  if (error) throw error;
  return (data ?? []) as SurveyResponse[];
}
