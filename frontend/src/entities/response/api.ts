import { fetchResponsesByForm, insertResponse } from "../../shared/api";
import type { SurveyResponse } from "./types";

export async function createResponse(formId: string, data: Record<string, unknown>) {
  return insertResponse(formId, data);
}

export async function getResponsesByForm(formId: string): Promise<SurveyResponse[]> {
  return fetchResponsesByForm(formId);
}
