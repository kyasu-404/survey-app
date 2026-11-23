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
  personalToken?: string,
  usePublicClient = false,
) {
  return personalToken || usePublicClient
    ? createResponse(formId, data, submissionId, browserId, personalToken, usePublicClient)
    : createResponse(formId, data, submissionId, browserId);
}

export function useSubmitResponseMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ formId, data, submissionId, browserId, personalToken, usePublicClient }: { formId: string; data: Record<string, unknown>; submissionId: string; browserId: string; personalToken?: string; usePublicClient?: boolean }) =>
      submitResponse(formId, data, submissionId, browserId, personalToken, usePublicClient),
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
    mutationFn: ({ formId, responseId, data, browserId, personalToken, usePublicClient }: {
      formId: string;
      responseId: string;
      data: Record<string, unknown>;
      browserId: string;
      personalToken?: string;
      usePublicClient?: boolean;
    }) => (personalToken || usePublicClient
      ? editResponse(formId, responseId, data, browserId, personalToken, usePublicClient)
      : editResponse(formId, responseId, data, browserId)),
    onSuccess: (_data, variables) => {
      scheduleQueryInvalidation(queryClient, "update response", [
        { queryKey: getFormResponsesQueryKey(variables.formId) },
      ]);
    },
  });
}
