import {
  fetchResponsesByForm,
  fetchExistingResponse,
  insertResponse,
  updateResponse,
  deleteResponses as deleteResponsesRequest,
  type FetchResponsesByFormOptions,
  type PaginatedResponses,
} from "../../shared/api";

export async function getExistingResponse(
  formId: string,
  browserId: string,
  signal?: AbortSignal,
) {
  return fetchExistingResponse(formId, browserId, signal);
}

export async function createResponse(
  formId: string,
  data: Record<string, unknown>,
  submissionId: string,
  browserId: string,
) {
  return insertResponse(formId, data, submissionId, browserId);
}

export async function editResponse(
  formId: string,
  responseId: string,
  data: Record<string, unknown>,
  browserId: string,
) {
  return updateResponse(formId, responseId, data, browserId);
}

export async function deleteResponses(formId: string, responseIds: string[]) {
  return deleteResponsesRequest(formId, responseIds);
}

export async function getResponsesByForm(
  formId: string,
  options?: FetchResponsesByFormOptions,
): Promise<PaginatedResponses> {
  return fetchResponsesByForm(formId, options);
}
