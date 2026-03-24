import { createResponse } from "../../entities/response/api";

export async function submitResponse(formId: string, data: Record<string, unknown>) {
  return createResponse(formId, data);
}
