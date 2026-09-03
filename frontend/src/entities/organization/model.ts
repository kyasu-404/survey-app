import type { SurveyQuestion, SurveySchema } from "../survey/types";
import {
  ORGANIZATION_TYPES,
  type EducationOrganizationInput,
  type OrganizationType,
  type SelectableOrganization,
} from "./types";

export const ORGANIZATION_QUESTION_TYPE = "organization";
export const DEFAULT_FORM_ORGANIZATION_TYPES: OrganizationType[] = ["school", "kindergarten"];

export const ORGANIZATION_TYPE_OPTIONS: Array<{
  value: OrganizationType;
  label: string;
  singularLabel: string;
  selectionLabel: string;
}> = [
  { value: "school", label: "Школы", singularLabel: "Школа", selectionLabel: "Школы" },
  { value: "kindergarten", label: "Сады", singularLabel: "Детский сад", selectionLabel: "Детские сады" },
  { value: "odo", label: "ОДО", singularLabel: "ОДО", selectionLabel: "ОДО" },
  { value: "udod", label: "УДОДы", singularLabel: "УДОД", selectionLabel: "УДОД" },
];

const NESTED_QUESTION_KEYS = ["elements", "items", "rows", "columns", "panels", "templateElements"] as const;

export function isOrganizationType(value: unknown): value is OrganizationType {
  return typeof value === "string" && ORGANIZATION_TYPES.includes(value as OrganizationType);
}

export function normalizeOrganizationTypes(value: unknown): OrganizationType[] {
  if (!Array.isArray(value)) {
    return [...DEFAULT_FORM_ORGANIZATION_TYPES];
  }

  const normalized = [...new Set(value.filter(isOrganizationType))];
  return normalized.length > 0 ? normalized : [...DEFAULT_FORM_ORGANIZATION_TYPES];
}

export function getOrganizationTypeLabel(type: OrganizationType, singular = false) {
  const option = ORGANIZATION_TYPE_OPTIONS.find((item) => item.value === type);
  return singular ? option?.singularLabel ?? type : option?.label ?? type;
}

export function getOrganizationDisplayName(
  organization: Pick<SelectableOrganization, "alias" | "number">,
) {
  return [organization.alias.trim(), organization.number?.trim()].filter(Boolean).join(" ");
}

export function normalizeOrganizationInput(input: EducationOrganizationInput): EducationOrganizationInput {
  const organizationType = isOrganizationType(input.organization_type) ? input.organization_type : "school";
  return {
    organization_type: organizationType,
    number: organizationType === "udod" ? null : input.number?.trim() || null,
    alias: input.alias.trim(),
    email: input.email.trim().toLowerCase(),
  };
}

export function validateOrganizationInput(input: EducationOrganizationInput) {
  const normalized = normalizeOrganizationInput(input);
  if (!normalized.alias) {
    return "Укажите алиас организации";
  }
  if (normalized.organization_type !== "udod" && !normalized.number) {
    return "Укажите номер организации";
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized.email)) {
    return "Укажите корректный email";
  }
  return null;
}

function visitQuestions(schema: SurveySchema, visitor: (question: SurveyQuestion) => void) {
  const pending: Array<{ value: unknown; depth: number }> = [
    ...((Array.isArray(schema.pages) ? schema.pages : []).map((page) => ({ value: page, depth: 0 }))),
  ];
  let visited = 0;

  while (pending.length > 0) {
    const current = pending.pop();
    if (!current || !current.value || typeof current.value !== "object") {
      continue;
    }
    visited += 1;
    if (current.depth > 32 || visited > 10_000) {
      return;
    }

    const record = current.value as Record<string, unknown>;
    if (typeof record.type === "string" && typeof record.name === "string") {
      visitor(record as SurveyQuestion);
    }

    NESTED_QUESTION_KEYS.forEach((key) => {
      const nested = record[key];
      if (Array.isArray(nested)) {
        nested.forEach((value) => pending.push({ value, depth: current.depth + 1 }));
      }
    });
  }
}

export function getOrganizationQuestionNames(schema: SurveySchema) {
  const names: string[] = [];
  visitQuestions(schema, (question) => {
    if (question.type === ORGANIZATION_QUESTION_TYPE) {
      names.push(question.name);
    }
  });
  return names;
}

export function hasOrganizationQuestion(schema: SurveySchema) {
  return getOrganizationQuestionNames(schema).length > 0;
}
