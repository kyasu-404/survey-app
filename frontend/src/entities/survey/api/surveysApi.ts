import {
  deleteForm,
  createFormFromTemplate as createRegularFormFromTemplate,
  duplicateForm,
  fetchFormById,
  fetchForms,
  fetchPublicFormById,
  insertForm,
  updateFormSchema,
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

export async function getPublicFormById(id: string): Promise<SurveyForm | null> {
  return fetchPublicFormById(id);
}

export async function createSurvey(params: {
  title: string;
  formType: string;
  formReason: string;
  schema: SurveySchema;
  authorId: string;
  isPublic?: boolean;
}) {
  return insertForm(params);
}


export async function renameForm(id: string, title: string) {
  return updateFormTitle(id, title);
}

export async function saveSurveySchema(id: string, schema: SurveySchema, title: string) {
  return updateFormSchema(id, schema, title);
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

export async function createFormFromTemplate(form: SurveyForm, authorId: string) {
  return createRegularFormFromTemplate(form, authorId);
}
