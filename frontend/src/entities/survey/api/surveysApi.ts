import {
  deleteForm,
  duplicateForm,
  fetchFormById,
  fetchForms,
  insertForm,
  updateFormDeadline,
  updateFormStatus,
  updateFormTitle,
  type FormsFilters,
} from "../../../shared/api";
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


export async function renameForm(id: string, title: string) {
  return updateFormTitle(id, title);
}

export async function changeFormStatus(id: string, isPublic: boolean) {
  return updateFormStatus(id, isPublic);
}

export async function setFormDeadline(id: string, deadlineAt: string | null) {
  return updateFormDeadline(id, deadlineAt);
}

export async function removeForm(id: string) {
  return deleteForm(id);
}

export async function cloneForm(form: SurveyForm, authorId: string) {
  return duplicateForm(form, authorId);
}
