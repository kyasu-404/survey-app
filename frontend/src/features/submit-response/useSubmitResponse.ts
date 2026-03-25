import { useMutation } from "@tanstack/react-query";
import { createResponse } from "../../entities/response/api";

export async function submitResponse(formId: string, data: Record<string, unknown>) {
  return createResponse(formId, data);
}

export function useSubmitResponseMutation() {
  return useMutation({
    mutationFn: ({ formId, data }: { formId: string; data: Record<string, unknown> }) =>
      submitResponse(formId, data),
  });
}
