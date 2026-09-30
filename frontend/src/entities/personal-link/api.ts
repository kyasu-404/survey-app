import { apiClient, publicApiClient } from "../../shared/api/client";
import { runRequest } from "../../shared/api/request";
import type { EducationOrganization, SelectableOrganization } from "../organization/types";

export type PersonalLink = Pick<EducationOrganization, "id" | "organization_type" | "number" | "alias" | "email"> & { token: string };
export type PersonalLinksState = { available: boolean; canManage: boolean; enabled: boolean; links: PersonalLink[] };

export async function getPersonalLinks(formId: string, signal?: AbortSignal): Promise<PersonalLinksState> {
  const { data, error } = await runRequest("personalLinks.get", requestSignal =>
    apiClient.rpc("get_form_personal_links", { p_form_id: formId }).abortSignal(requestSignal), { signal, context: { formId } });
  if (error) throw error;
  return data as PersonalLinksState;
}

export async function setPersonalLinks(formId: string, enabled: boolean): Promise<PersonalLinksState> {
  const { data, error } = await runRequest("personalLinks.set", signal =>
    apiClient.rpc("set_form_personal_links", { p_form_id: formId, p_enabled: enabled }).abortSignal(signal), { context: { formId } });
  if (error) throw error;
  return data as PersonalLinksState;
}

export async function getPersonalFormContext(formId: string, token: string, signal?: AbortSignal): Promise<SelectableOrganization> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(token)) {
    throw new Error("Персональная ссылка недействительна");
  }
  const { data, error } = await runRequest("personalLinks.resolve", requestSignal =>
    publicApiClient.rpc("get_personal_form_context", { p_form_id: formId, p_token: token }).abortSignal(requestSignal), { signal, context: { formId } });
  if (error) throw error;
  if (!data) throw new Error("Персональная ссылка недействительна или форма закрыта");
  return data as SelectableOrganization;
}

export function getPersonalFormUrl(formId: string, token: string, origin = window.location.origin) {
  const url = new URL(`/form/${formId}`, origin);
  url.hash = new URLSearchParams({ personal: token }).toString();
  return url.toString();
}
