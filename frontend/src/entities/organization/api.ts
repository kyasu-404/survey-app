import { apiClient } from "../../shared/api/client";
import { runRequest } from "../../shared/api/request";
import { normalizeOrganizationInput } from "./model";
import type {
  EducationOrganization,
  EducationOrganizationInput,
  OrganizationType,
  SelectableOrganization,
} from "./types";

const ORGANIZATION_SELECT = "id, organization_type, number, alias, email, created_at, updated_at";
const ORGANIZATIONS_PAGE_SIZE = 1000;

export async function getOrganizations(types?: OrganizationType[], signal?: AbortSignal) {
  const organizations: EducationOrganization[] = [];
  for (let offset = 0; ; offset += ORGANIZATIONS_PAGE_SIZE) {
    signal?.throwIfAborted();
    const { data, error } = await runRequest(
      "organizations.list",
      (requestSignal) => {
        let query = apiClient
          .from("education_organizations")
          .select(ORGANIZATION_SELECT)
          .order("organization_type")
          .order("number", { nullsFirst: false })
          .order("alias")
          .order("id");
        if (types?.length) {
          query = query.in("organization_type", types);
        }
        return query.range(offset, offset + ORGANIZATIONS_PAGE_SIZE - 1).abortSignal(requestSignal);
      },
      { signal, context: { types: types ?? null, offset } },
    );
    if (error) throw error;
    const page = (data ?? []) as EducationOrganization[];
    organizations.push(...page);
    if (page.length < ORGANIZATIONS_PAGE_SIZE) return organizations;
  }
}

export async function getFormOrganizations(formId: string, signal?: AbortSignal) {
  const organizations: SelectableOrganization[] = [];
  for (let offset = 0; ; offset += ORGANIZATIONS_PAGE_SIZE) {
    signal?.throwIfAborted();
    const { data, error } = await runRequest(
      "organizations.listForForm",
      (requestSignal) => apiClient
        .rpc("list_form_organizations", { p_form_id: formId })
        .range(offset, offset + ORGANIZATIONS_PAGE_SIZE - 1)
        .abortSignal(requestSignal),
      { signal, context: { formId, offset } },
    );
    if (error) throw error;
    const page = (data ?? []) as SelectableOrganization[];
    organizations.push(...page);
    if (page.length < ORGANIZATIONS_PAGE_SIZE) return organizations;
  }
}

export async function createOrganization(input: EducationOrganizationInput) {
  const payload = normalizeOrganizationInput(input);
  const { data, error } = await runRequest(
    "organizations.create",
    () => apiClient.from("education_organizations").insert(payload).select(ORGANIZATION_SELECT).single(),
    { context: { organizationType: payload.organization_type } },
  );
  if (error) throw error;
  return data as EducationOrganization;
}

export async function updateOrganization(id: string, input: EducationOrganizationInput) {
  const payload = normalizeOrganizationInput(input);
  const { data, error } = await runRequest(
    "organizations.update",
    () => apiClient.from("education_organizations").update(payload).eq("id", id).select(ORGANIZATION_SELECT).single(),
    { context: { organizationId: id, organizationType: payload.organization_type } },
  );
  if (error) throw error;
  return data as EducationOrganization;
}

export async function deleteOrganization(id: string) {
  const { error } = await runRequest(
    "organizations.delete",
    () => apiClient.from("education_organizations").delete().eq("id", id),
    { context: { organizationId: id } },
  );
  if (error) throw error;
}

export async function deleteAllOrganizations() {
  const { error } = await runRequest(
    "organizations.deleteAll",
    () => apiClient.from("education_organizations").delete().not("id", "is", null),
  );
  if (error) throw error;
}

export async function importOrganizations(inputs: EducationOrganizationInput[]) {
  const payload = inputs.map(normalizeOrganizationInput);
  for (let index = 0; index < payload.length; index += 500) {
    const batch = payload.slice(index, index + 500);
    const { error } = await runRequest(
      "organizations.import",
      () => apiClient.from("education_organizations").upsert(batch, {
        onConflict: "organization_type,number,alias",
      }),
      { context: { batchSize: batch.length } },
    );
    if (error) throw error;
  }
}
