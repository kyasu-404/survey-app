export type DashboardFormsQueryParams = {
  dateFrom: string;
  dateTo: string;
  search: string;
  pageSize: number;
  viewMode: "mine" | "all";
  userId: string | null;
};

export type TemplatesQueryParams = {
  section: "mine" | "public";
  pageSize: number;
  userId: string | null;
};

export const DASHBOARD_FORMS_QUERY_ROOT = ["dashboard-form-summaries"] as const;
export const DASHBOARD_FORM_STATS_QUERY_ROOT = ["dashboard-form-stats"] as const;
export const TEMPLATE_FORMS_QUERY_ROOT = ["template-form-summaries"] as const;
export const FORM_QUERY_ROOT = ["form"] as const;
export const SURVEY_FORM_QUERY_ROOT = ["survey-form"] as const;
export const FORM_RESPONSES_QUERY_ROOT = ["form-responses"] as const;
export const USERS_QUERY_ROOT = ["users"] as const;

export function getDashboardFormsQueryKey(params: DashboardFormsQueryParams) {
  return [...DASHBOARD_FORMS_QUERY_ROOT, params] as const;
}

export function getDashboardFormStatsQueryKey(
  params: Omit<DashboardFormsQueryParams, "pageSize">,
) {
  return [...DASHBOARD_FORM_STATS_QUERY_ROOT, params] as const;
}

export function getTemplateFormsQueryKey(params: TemplatesQueryParams) {
  return [...TEMPLATE_FORMS_QUERY_ROOT, params] as const;
}

export function getFormQueryKey(formId: string | undefined) {
  return [...FORM_QUERY_ROOT, formId] as const;
}

export function getSurveyFormQueryKey(formId: string | undefined) {
  return [...SURVEY_FORM_QUERY_ROOT, formId] as const;
}

export function getFormResponsesQueryKey(
  formId: string | undefined,
  ...segments: Array<string | number | boolean | null | undefined>
) {
  return [...FORM_RESPONSES_QUERY_ROOT, formId, ...segments] as const;
}
