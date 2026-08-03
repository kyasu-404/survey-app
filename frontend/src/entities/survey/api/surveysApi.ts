import {
  deleteForm,
  createFormFromTemplate as createRegularFormFromTemplate,
  duplicateForm,
  fetchDashboardFormsPage,
  fetchDashboardFormsStats,
  fetchFormById,
  fetchForms,
  fetchPublicFormById,
  fetchTemplateFormsPage,
  insertForm,
  updateFormSchema,
  updateFormDeadline,
  updateFormResponseLimit,
  updateFormStatus,
  updateFormTitle,
  type FormsFilters,
} from "../../../shared/api";
import type {
  DashboardFormsStats,
  PaginatedSurveyFormSummaries,
  SurveyForm,
  SurveySchema,
} from "../types";
import type { ITheme } from "survey-core";
import type { OrganizationType } from "../../organization/types";

export type { FormsFilters };

type QueryRequestOptions = {
  signal?: AbortSignal;
};

export async function getForms(filters?: FormsFilters): Promise<SurveyForm[]> {
  return fetchForms(filters);
}

export async function getDashboardFormsPage(params: {
  page: number;
  pageSize: number;
  filters?: FormsFilters;
  signal?: AbortSignal;
}): Promise<PaginatedSurveyFormSummaries> {
  return fetchDashboardFormsPage(params);
}

export async function getDashboardFormsStats(
  filters?: FormsFilters,
  options?: QueryRequestOptions,
): Promise<DashboardFormsStats> {
  return fetchDashboardFormsStats(filters, options);
}

export async function getTemplateFormsPage(params: {
  page: number;
  pageSize: number;
  filters?: FormsFilters;
  signal?: AbortSignal;
}): Promise<PaginatedSurveyFormSummaries> {
  return fetchTemplateFormsPage(params);
}

export async function getFormById(id: string, options?: QueryRequestOptions): Promise<SurveyForm> {
  return fetchFormById(id, options);
}

export async function getPublicFormById(id: string, options?: QueryRequestOptions): Promise<SurveyForm | null> {
  return fetchPublicFormById(id, options);
}

export async function createSurvey(params: {
  id?: string;
  title: string;
  formType: string;
  formReason: string;
  schema: SurveySchema;
  theme?: ITheme;
  authorId: string;
  deadlineAt?: string | null;
  maxResponses?: number | null;
  allowResponseEditing?: boolean;
  organizationTypes?: OrganizationType[];
  isPublic?: boolean;
}) {
  return insertForm(params);
}

export async function renameForm(id: string, title: string) {
  return updateFormTitle(id, title);
}

export async function saveSurveySchema(
  id: string,
  schema: SurveySchema,
  theme: ITheme,
  title: string,
  allowResponseEditing: boolean,
  organizationTypes: OrganizationType[],
) {
  return updateFormSchema(id, schema, theme, title, allowResponseEditing, organizationTypes);
}

export async function changeFormStatus(id: string, isPublic: boolean) {
  return updateFormStatus(id, isPublic);
}

export async function setFormDeadline(id: string, deadlineAt: string | null) {
  return updateFormDeadline(id, deadlineAt);
}

export async function setFormResponseLimit(id: string, maxResponses: number | null) {
  return updateFormResponseLimit(id, maxResponses);
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
