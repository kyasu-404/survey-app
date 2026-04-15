import { useMutation } from "@tanstack/react-query";
import { createSurvey } from "../../entities/survey/api/surveysApi";
import { DEFAULT_FORM_REASON, DEFAULT_FORM_TYPE } from "../../entities/survey/model/formOptions";
import type { SurveySchema } from "../../entities/survey/types";
import { apiClient } from "../../shared/api";
import { runRequest } from "../../shared/api/request";

type CreateSurveyForCurrentUserParams = {
  schema: SurveySchema;
  title: string;
  formType?: string;
  formReason?: string;
  deadlineAt?: string | null;
  maxResponses?: number | null;
  isPublic?: boolean;
};

export async function createSurveyForCurrentUser({
  schema,
  title,
  formType = DEFAULT_FORM_TYPE,
  formReason = DEFAULT_FORM_REASON,
  deadlineAt,
  maxResponses,
  isPublic,
}: CreateSurveyForCurrentUserParams) {
  const { data } = await runRequest("auth.getCurrentUser", () => apiClient.auth.getCurrentUser());
  const userId = data.user?.id;

  if (!userId) {
    throw new Error("Пользователь не авторизован");
  }

  const createSurveyPayload = {
    title,
    formType,
    formReason,
    schema,
    authorId: userId,
    ...(deadlineAt !== undefined ? { deadlineAt } : {}),
    ...(maxResponses !== undefined ? { maxResponses } : {}),
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
    mutationFn: ({ schema, title, formType, formReason, deadlineAt, maxResponses, isPublic }: CreateSurveyForCurrentUserParams) =>
      createSurveyForCurrentUser({ schema, title, formType, formReason, deadlineAt, maxResponses, isPublic }),
  });
}
