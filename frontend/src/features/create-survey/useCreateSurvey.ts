import { useMutation } from "@tanstack/react-query";
import { createSurvey } from "../../entities/survey/api/surveysApi";
import { DEFAULT_FORM_REASON, DEFAULT_FORM_TYPE } from "../../entities/survey/model/formOptions";
import type { SurveySchema } from "../../entities/survey/types";
import type { ITheme } from "survey-core";
import { DEFAULT_SURVEY_THEME } from "../../entities/survey/model/surveyTheme";
import { apiClient } from "../../shared/api";
import { runRequest } from "../../shared/api/request";
import type { OrganizationType } from "../../entities/organization/types";

type CreateSurveyForCurrentUserParams = {
  id?: string;
  schema: SurveySchema;
  theme?: ITheme;
  title: string;
  formType?: string;
  formReason?: string;
  deadlineAt?: string | null;
  maxResponses?: number | null;
  allowResponseEditing?: boolean;
  organizationTypes?: OrganizationType[];
  isPublic?: boolean;
};

export async function createSurveyForCurrentUser({
  id,
  schema,
  theme = DEFAULT_SURVEY_THEME,
  title,
  formType = DEFAULT_FORM_TYPE,
  formReason = DEFAULT_FORM_REASON,
  deadlineAt,
  maxResponses,
  allowResponseEditing,
  organizationTypes,
  isPublic,
}: CreateSurveyForCurrentUserParams) {
  const { data } = await runRequest("auth.getCurrentUser", () => apiClient.auth.getCurrentUser());
  const userId = data.user?.id;

  if (!userId) {
    throw new Error("Пользователь не авторизован");
  }

  const createSurveyPayload = {
    ...(id ? { id } : {}),
    title,
    formType,
    formReason,
    schema,
    theme,
    authorId: userId,
    ...(deadlineAt !== undefined ? { deadlineAt } : {}),
    ...(maxResponses !== undefined ? { maxResponses } : {}),
    ...(allowResponseEditing !== undefined ? { allowResponseEditing } : {}),
    ...(organizationTypes !== undefined ? { organizationTypes } : {}),
  };
  const resolvedIsPublic =
    typeof isPublic === "boolean" ? isPublic : formType === "template" ? false : undefined;

  return createSurvey(
    typeof resolvedIsPublic === "boolean"
      ? {
          ...createSurveyPayload,
          isPublic: resolvedIsPublic,
        }
      : createSurveyPayload,
  );
}

export function useCreateSurveyMutation() {
  return useMutation({
    mutationFn: ({ id, schema, theme, title, formType, formReason, deadlineAt, maxResponses, allowResponseEditing, organizationTypes, isPublic }: CreateSurveyForCurrentUserParams) =>
      createSurveyForCurrentUser({ id, schema, theme, title, formType, formReason, deadlineAt, maxResponses, allowResponseEditing, organizationTypes, isPublic }),
  });
}
