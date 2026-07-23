import type { SurveyFormSummary } from "../../entities/survey/types";

export type DashboardViewMode = "mine" | "all";

export type DashboardPageProps = {
  viewMode: DashboardViewMode;
};

export type DeadlineEditorState = {
  form: SurveyFormSummary;
  value: string;
};

export type ResponseLimitEditorState = {
  form: SurveyFormSummary;
  value: string;
};

export type QrDialogState = {
  fileName: string;
  link: string;
  previewDataUrl: string;
  title: string;
};

export type DashboardActionOptions = {
  actionKey: string;
  successMessage: string;
  errorMessage: string;
  shouldReloadForms?: boolean;
  affectedFormId?: string;
  logLabel: string;
};

export type DashboardRunAction = (action: () => Promise<unknown>, options: DashboardActionOptions) => Promise<void>;

export type DashboardShowToast = (message: string, type?: "success" | "error" | "warning") => void;

export type OpenMenuState =
  | { kind: "actions"; formId: string }
  | { kind: "status"; formId: string }
  | { kind: "stats" }
  | null;

export type ListRefreshNavigationState = {
  refreshList?: boolean;
};

export type DashboardListFilters = {
  authorId?: string;
  dateFrom?: string;
  dateTo?: string;
  formReason?: string;
  formType?: string;
  search?: string;
};
