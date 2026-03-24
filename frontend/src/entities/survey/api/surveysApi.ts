import { fetchFormById, fetchForms, insertForm, type FormsFilters } from "../../../shared/api";
import type { SurveyForm, SurveySchema } from "../types";

export type { FormsFilters };

export async function getForms(filters?: FormsFilters): Promise<SurveyForm[]> {
  return fetchForms(filters);
}

export async function getFormById(id: string): Promise<SurveyForm> {
  return fetchFormById(id);
}

export async function createSurvey(params: {
  title: string;
  formType: string;
  formReason: string;
  schema: SurveySchema;
  authorId: string;
}) {
  return insertForm(params);
}
