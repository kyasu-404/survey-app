export const ORGANIZATION_TYPES = ["school", "kindergarten", "odo", "udod"] as const;

export type OrganizationType = (typeof ORGANIZATION_TYPES)[number];

export type EducationOrganization = {
  id: string;
  organization_type: OrganizationType;
  number: string | null;
  alias: string;
  email: string;
  created_at: string;
  updated_at: string;
};

export type SelectableOrganization = Pick<
  EducationOrganization,
  "id" | "organization_type" | "number" | "alias"
>;

export type EducationOrganizationInput = {
  organization_type: OrganizationType;
  number: string | null;
  alias: string;
  email: string;
};
