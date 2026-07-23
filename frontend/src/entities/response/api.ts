import {
  fetchResponsesByForm,
  insertResponse,
  type FetchResponsesByFormOptions,
  type PaginatedResponses,
} from "../../shared/api";

export async function createResponse(formId: string, data: Record<string, unknown>, submissionId: string) {
  return insertResponse(formId, data, submissionId);
}

export async function getResponsesByForm(
  formId: string,
  options?: FetchResponsesByFormOptions,
): Promise<PaginatedResponses> {
  return fetchResponsesByForm(formId, options);
}
