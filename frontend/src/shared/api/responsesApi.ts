import { apiClient } from "./client";
import type { SurveyResponse } from "../../entities/response/types";
import { runRequest } from "./request";

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

export async function fetchResponsesByForm(formId: string): Promise<SurveyResponse[]> {
  const { data, error } = await runRequest(
    "responses.fetchByForm",
    () =>
      apiClient
        .from("responses")
        .select("*")
        .eq("form_id", formId)
        .order("created_at", { ascending: false }),
    { context: { formId } },
  );

  if (error) throw error;
  return (data ?? []) as SurveyResponse[];
}
