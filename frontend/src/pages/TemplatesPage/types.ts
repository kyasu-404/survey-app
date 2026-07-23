export type TemplatesSection = "mine" | "public";

export type TemplateActionOptions = {
  actionKey: string;
  successMessage: string;
  errorMessage: string;
  affectedTemplateId?: string;
  shouldReloadTemplates?: boolean;
  logLabel: string;
};

export type ListRefreshNavigationState = {
  refreshList?: boolean;
};
