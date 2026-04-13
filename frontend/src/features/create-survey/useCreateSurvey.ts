import { useMutation } from "@tanstack/react-query";
import { createSurvey } from "../../entities/survey/api/surveysApi";
import type { SurveySchema } from "../../entities/survey/types";
import { apiClient } from "../../shared/api";
import { runRequest } from "../../shared/api/request";

type CreateSurveyForCurrentUserParams = {
  schema: SurveySchema;
  title: string;
  formType?: string;
  formReason?: string;
  isPublic?: boolean;
};

export async function createSurveyForCurrentUser({
  schema,
  title,
  formType = "anketa",
  formReason = "plan",
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
    mutationFn: ({ schema, title, formType, formReason, isPublic }: CreateSurveyForCurrentUserParams) =>
      createSurveyForCurrentUser({ schema, title, formType, formReason, isPublic }),
  });
}
