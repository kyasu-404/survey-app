import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createResponse } from "../../entities/response/api";
import {
  DASHBOARD_FORMS_QUERY_ROOT,
  DASHBOARD_FORM_STATS_QUERY_ROOT,
  getFormQueryKey,
  getFormResponsesQueryKey,
  getSurveyFormQueryKey,
} from "../../entities/survey/model/queryKeys";
import { scheduleQueryInvalidation } from "../../shared/lib/queryRefresh";

export async function submitResponse(formId: string, data: Record<string, unknown>) {
  return createResponse(formId, data);
}

export function useSubmitResponseMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ formId, data }: { formId: string; data: Record<string, unknown> }) =>
      submitResponse(formId, data),
    onSuccess: (_data, variables) => {
      scheduleQueryInvalidation(queryClient, "submit response", [
        { queryKey: DASHBOARD_FORMS_QUERY_ROOT },
        { queryKey: DASHBOARD_FORM_STATS_QUERY_ROOT },
        { queryKey: getFormQueryKey(variables.formId) },
        { queryKey: getSurveyFormQueryKey(variables.formId) },
        { queryKey: getFormResponsesQueryKey(variables.formId) },
      ]);
    },
  });
}
