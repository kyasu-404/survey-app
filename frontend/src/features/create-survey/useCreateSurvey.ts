import { useMutation } from "@tanstack/react-query";
import { createSurvey } from "../../entities/survey/api/surveysApi";
import type { SurveySchema } from "../../entities/survey/types";
import { apiClient } from "../../shared/api";

export async function createSurveyForCurrentUser(schema: SurveySchema, title: string) {
  const { data } = await apiClient.auth.getCurrentUser();
  const userId = data.user?.id;

  if (!userId) {
    throw new Error("Пользователь не авторизован");
  }

  return createSurvey({
    title,
    formType: "anketa",
    formReason: "plan",
    schema,
    authorId: userId,
  });
}

export function useCreateSurveyMutation() {
  return useMutation({
    mutationFn: ({ schema, title }: { schema: SurveySchema; title: string }) =>
      createSurveyForCurrentUser(schema, title),
  });
}
