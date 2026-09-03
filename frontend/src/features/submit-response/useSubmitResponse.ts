import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createResponse, editResponse } from "../../entities/response/api";
import {
  getFormQueryKey,
  getFormResponsesQueryKey,
} from "../../entities/survey/model/queryKeys";
import { scheduleQueryInvalidation } from "../../shared/lib/queryRefresh";

export async function submitResponse(
  formId: string,
  data: Record<string, unknown>,
  submissionId: string,
  browserId: string,
) {
  return createResponse(formId, data, submissionId, browserId);
}

export function useSubmitResponseMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ formId, data, submissionId, browserId }: { formId: string; data: Record<string, unknown>; submissionId: string; browserId: string }) =>
      submitResponse(formId, data, submissionId, browserId),
    onSuccess: (_data, variables) => {
      scheduleQueryInvalidation(queryClient, "submit response", [
        { queryKey: getFormQueryKey(variables.formId) },
        { queryKey: getFormResponsesQueryKey(variables.formId) },
      ]);
    },
  });
}

export function useUpdateResponseMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ formId, responseId, data, browserId }: {
      formId: string;
      responseId: string;
      data: Record<string, unknown>;
      browserId: string;
    }) => editResponse(formId, responseId, data, browserId),
    onSuccess: (_data, variables) => {
      scheduleQueryInvalidation(queryClient, "update response", [
        { queryKey: getFormResponsesQueryKey(variables.formId) },
      ]);
    },
  });
}
