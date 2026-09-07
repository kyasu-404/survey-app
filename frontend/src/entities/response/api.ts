import {
  fetchResponsesByForm,
  fetchAllResponsesByForm,
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
  const ids = [...new Set(responseIds)];
  for (let offset = 0; offset < ids.length; offset += 100) {
    await deleteResponsesRequest(formId, ids.slice(offset, offset + 100));
  }
}

export async function getResponsesByForm(
  formId: string,
  options?: FetchResponsesByFormOptions,
): Promise<PaginatedResponses> {
  return fetchResponsesByForm(formId, options);
}

export async function getAllResponsesByForm(
  formId: string,
  options?: Omit<FetchResponsesByFormOptions, "page" | "pageSize">,
) {
  return fetchAllResponsesByForm(formId, options);
}
