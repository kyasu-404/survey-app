import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createResponse } from "../../entities/response/api";
import {
  getFormQueryKey,
  getFormResponsesQueryKey,
} from "../../entities/survey/model/queryKeys";
import { scheduleQueryInvalidation } from "../../shared/lib/queryRefresh";

export async function submitResponse(formId: string, data: Record<string, unknown>, submissionId: string) {
  return createResponse(formId, data, submissionId);
}

export function useSubmitResponseMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ formId, data, submissionId }: { formId: string; data: Record<string, unknown>; submissionId: string }) =>
      submitResponse(formId, data, submissionId),
    onSuccess: (_data, variables) => {
      scheduleQueryInvalidation(queryClient, "submit response", [
        { queryKey: getFormQueryKey(variables.formId) },
        { queryKey: getFormResponsesQueryKey(variables.formId) },
      ]);
    },
  });
}
