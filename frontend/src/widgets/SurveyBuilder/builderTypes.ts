import type { ITheme } from "survey-core";
import type { OrganizationType } from "../../entities/organization/types";
import type { SchemaUpdateResult } from "../../entities/survey/api/surveysApi";
import type { SurveySchema } from "../../entities/survey/types";

export type PostSaveSettingsState = {
  title: string;
  schema: SurveySchema;
  theme: ITheme;
  assetFormId: string;
  deadlineValue: string;
  responseLimitValue: string;
  formTypeValue: string;
  formReasonValue: string;
  allowResponseEditing: boolean;
  organizationTypes: OrganizationType[];
};

export type ExistingFormSaveRequest = {
  allowResponseEditing: boolean;
  callback: (saveNo: number, isSuccess: boolean) => void;
  id: string;
  isTemplate: boolean;
  saveNo: number;
  schema: SurveySchema;
  selectedOrganizationTypes: OrganizationType[];
  theme: ITheme;
  title: string;
};

export type CompatibilityDialogState = {
  request: ExistingFormSaveRequest;
  result: SchemaUpdateResult;
};

