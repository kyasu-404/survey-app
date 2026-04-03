import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createResponse } from "../../entities/response/api";

export async function submitResponse(formId: string, data: Record<string, unknown>) {
  return createResponse(formId, data);
}

export function useSubmitResponseMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ formId, data }: { formId: string; data: Record<string, unknown> }) =>
      submitResponse(formId, data),
    onSuccess: async (_data, variables) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["forms"] }),
        queryClient.invalidateQueries({ queryKey: ["form", variables.formId] }),
        queryClient.invalidateQueries({ queryKey: ["survey-form", variables.formId] }),
        queryClient.invalidateQueries({ queryKey: ["form-responses", variables.formId] }),
      ]);
    },
  });
}
