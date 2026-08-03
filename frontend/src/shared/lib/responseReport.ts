import {
  getOrganizationDisplayName,
  getOrganizationQuestionNames,
  ORGANIZATION_QUESTION_TYPE,
} from "../../entities/organization/model";
import type { EducationOrganization } from "../../entities/organization/types";
import type { SurveyResponse } from "../../entities/response/types";
import type { SurveyQuestion, SurveySchema } from "../../entities/survey/types";

export type ResponseReportValue = {
  label: string;
  count: number;
};

export type ResponseQuestionReport = {
  name: string;
  title: string;
  type: string;
  answeredCount: number;
  missingCount: number;
  values: ResponseReportValue[];
};

export type ResponseOrganizationCoverage = {
  expectedCount: number;
  submittedCount: number;
  missingOrganizations: EducationOrganization[];
};

export type ResponseReport = {
  totalResponses: number;
  questionReports: ResponseQuestionReport[];
  organizationCoverage: ResponseOrganizationCoverage | null;
};

const NESTED_KEYS = ["elements", "items", "rows", "columns", "panels", "templateElements"] as const;
const STRUCTURAL_TYPES = new Set(["panel", "paneldynamic", "html", "expression", "image"]);
const DISTRIBUTION_TYPES = new Set([
  "radiogroup",
  "checkbox",
  "dropdown",
  "tagbox",
  "boolean",
  "rating",
  "ranking",
  ORGANIZATION_QUESTION_TYPE,
]);

function isAnswered(value: unknown) {
  if (value === null || typeof value === "undefined") return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value).length > 0;
  return true;
}

function getQuestions(schema: SurveySchema) {
  const questions: SurveyQuestion[] = [];
  const pending: Array<{ value: unknown; depth: number }> = [
    ...((schema.pages ?? []).map((page) => ({ value: page, depth: 0 }))),
  ];
  let visited = 0;

  while (pending.length > 0) {
    const current = pending.pop();
    if (!current || !current.value || typeof current.value !== "object") continue;
    visited += 1;
    if (current.depth > 32 || visited > 10_000) break;
    const record = current.value as Record<string, unknown>;
    if (
      typeof record.type === "string"
      && typeof record.name === "string"
      && !STRUCTURAL_TYPES.has(record.type)
    ) {
      questions.push(record as SurveyQuestion);
    }
    NESTED_KEYS.forEach((key) => {
      const nested = record[key];
      if (Array.isArray(nested)) {
        nested.forEach((value) => pending.push({ value, depth: current.depth + 1 }));
      }
    });
  }
  return questions;
}

function getChoiceLabels(question: SurveyQuestion) {
  const labels = new Map<string, string>();
  question.choices?.forEach((choice) => {
    if (typeof choice === "string") {
      labels.set(choice, choice);
    } else {
      const value = String(choice.value ?? choice.text ?? "");
      if (value) labels.set(value, String(choice.text ?? choice.value ?? value));
    }
  });
  return labels;
}

export function createResponseReport(
  responses: SurveyResponse[],
  schema: SurveySchema,
  organizations: EducationOrganization[] = [],
): ResponseReport {
  const organizationLabels = new Map(
    organizations.map((organization) => [organization.id, getOrganizationDisplayName(organization)]),
  );
  const questions = getQuestions(schema);
  const questionReports = questions.map((question): ResponseQuestionReport => {
    const choiceLabels = getChoiceLabels(question);
    const counts = new Map<string, number>();
    let answeredCount = 0;

    responses.forEach((response) => {
      const value = response.data[question.name];
      if (!isAnswered(value)) return;
      answeredCount += 1;
      if (!DISTRIBUTION_TYPES.has(question.type)) return;
      const values = Array.isArray(value) ? value : [value];
      values.forEach((item) => {
        const rawValue = String(item ?? "");
        if (!rawValue) return;
        const label = question.type === ORGANIZATION_QUESTION_TYPE
          ? organizationLabels.get(rawValue) ?? rawValue
          : question.type === "boolean"
            ? rawValue === "true" ? "Да" : rawValue === "false" ? "Нет" : rawValue
            : choiceLabels.get(rawValue) ?? rawValue;
        counts.set(label, (counts.get(label) ?? 0) + 1);
      });
    });

    return {
      name: question.name,
      title: question.title?.trim() || question.name,
      type: question.type,
      answeredCount,
      missingCount: Math.max(0, responses.length - answeredCount),
      values: [...counts.entries()]
        .map(([label, count]) => ({ label, count }))
        .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label, "ru")),
    };
  });

  const organizationQuestionNames = getOrganizationQuestionNames(schema);
  let organizationCoverage: ResponseOrganizationCoverage | null = null;
  if (organizationQuestionNames.length > 0) {
    const submittedIds = new Set<string>();
    responses.forEach((response) => {
      organizationQuestionNames.forEach((name) => {
        const value = response.data[name];
        if (typeof value === "string") submittedIds.add(value);
      });
    });
    const expectedIds = new Set(organizations.map((organization) => organization.id));
    organizationCoverage = {
      expectedCount: organizations.length,
      submittedCount: [...submittedIds].filter((id) => expectedIds.has(id)).length,
      missingOrganizations: organizations.filter((organization) => !submittedIds.has(organization.id)),
    };
  }

  return {
    totalResponses: responses.length,
    questionReports,
    organizationCoverage,
  };
}
