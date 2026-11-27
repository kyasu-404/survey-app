import {
  fetchResponsesByForm,
  fetchAllResponsesByForm,
  fetchExistingResponse,
  insertResponse,
  updateResponse,
  deleteResponses as deleteResponsesRequest,
  type FetchResponsesByFormOptions,
  type PaginatedResponses,
} from "./responsesApi";

export {
  fetchResponsesForSorting as getResponsesForSorting,
  fetchSelectedResponseNumbers as getSelectedResponseNumbers,
} from "./responsesApi";

export async function getExistingResponse(
  formId: string,
  browserId: string,
  signal?: AbortSignal,
  personalToken?: string,
  usePublicClient = false,
) {
  return personalToken || usePublicClient
    ? fetchExistingResponse(formId, browserId, signal, personalToken, usePublicClient)
    : fetchExistingResponse(formId, browserId, signal);
}

export async function createResponse(
  formId: string,
  data: Record<string, unknown>,
  submissionId: string,
  browserId: string,
  personalToken?: string,
  usePublicClient = false,
) {
  return personalToken || usePublicClient
    ? insertResponse(formId, data, submissionId, browserId, undefined, personalToken, usePublicClient)
    : insertResponse(formId, data, submissionId, browserId);
}

export async function editResponse(
  formId: string,
  responseId: string,
  data: Record<string, unknown>,
  browserId: string,
  personalToken?: string,
  usePublicClient = false,
) {
  return personalToken || usePublicClient
    ? updateResponse(formId, responseId, data, browserId, undefined, personalToken, usePublicClient)
    : updateResponse(formId, responseId, data, browserId);
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
  options?: { signal?: AbortSignal; responseIds?: string[] },
) {
  return fetchAllResponsesByForm(formId, options);
}
