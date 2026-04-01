import { useMutation } from "@tanstack/react-query";
import { createSurvey } from "../../entities/survey/api/surveysApi";
import type { SurveySchema } from "../../entities/survey/types";
import { apiClient } from "../../shared/api";

type CreateSurveyForCurrentUserParams = {
  schema: SurveySchema;
  title: string;
  formType?: string;
  formReason?: string;
};

export async function createSurveyForCurrentUser({
  schema,
  title,
  formType = "anketa",
  formReason = "plan",
}: CreateSurveyForCurrentUserParams) {
  const { data } = await apiClient.auth.getCurrentUser();
  const userId = data.user?.id;

  if (!userId) {
    throw new Error("Пользователь не авторизован");
  }

  return createSurvey({
    title,
    formType,
    formReason,
    schema,
    authorId: userId,
  });
}

export function useCreateSurveyMutation() {
  return useMutation({
    mutationFn: ({ schema, title, formType, formReason }: CreateSurveyForCurrentUserParams) =>
      createSurveyForCurrentUser({ schema, title, formType, formReason }),
  });
}
