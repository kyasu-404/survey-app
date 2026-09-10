import { getOrganizationQuestionNames, ORGANIZATION_QUESTION_TYPE } from "../../entities/organization/model";
import type { EducationOrganization } from "../../entities/organization/types";
import type { SurveyResponse } from "../../entities/response/types";
import type { SurveyQuestion, SurveySchema } from "../../entities/survey/types";

export type ResponseReportValue = {
  label: string;
  count: number;
  percentage: number;
};

export type ResponseReportMetric = {
  label: string;
  value: string;
};

export type ResponseReportGroup = {
  label: string;
  metrics: ResponseReportMetric[];
  values: ResponseReportValue[];
};

export type ResponseQuestionAnalysisKind =
  | "single-choice"
  | "multiple-choice"
  | "numeric"
  | "rating"
  | "date"
  | "time"
  | "text"
  | "ranking"
  | "matrix"
  | "attachment";

export type ResponseQuestionReport = {
  name: string;
  title: string;
  type: string;
  kind: ResponseQuestionAnalysisKind;
  answeredCount: number;
  missingCount: number;
  metrics: ResponseReportMetric[];
  values: ResponseReportValue[];
  groups: ResponseReportGroup[];
};

export type ResponseOrganizationCoverage = {
  expectedCount: number;
  submittedCount: number;
  submittedOrganizations: EducationOrganization[];
  missingOrganizations: EducationOrganization[];
};

export type ResponseReport = {
  totalResponses: number;
  questionReports: ResponseQuestionReport[];
  organizationCoverage: ResponseOrganizationCoverage | null;
};

type QuestionDescriptor = {
  question: SurveyQuestion;
  path: string[];
};

const NESTED_KEYS = ["elements", "items", "rows", "columns", "panels", "templateElements"] as const;
const STRUCTURAL_TYPES = new Set(["panel", "paneldynamic", "html", "expression", "image", "sectiontitle"]);
const SINGLE_CHOICE_TYPES = new Set(["radiogroup", "dropdown", "boolean", "imagepicker"]);
const MULTIPLE_CHOICE_TYPES = new Set(["checkbox", "tagbox"]);
const MATRIX_TYPES = new Set(["matrix", "matrixdropdown", "matrixdynamic", "multipletext"]);
const DATE_TYPES = new Set(["date", "datetime"]);
const NUMBER_FORMAT = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 });
const DATE_FORMAT = new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" });
const MONTH_FORMAT = new Intl.DateTimeFormat("ru-RU", { month: "long", year: "numeric" });

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isAnswered(value: unknown) {
  if (value === null || typeof value === "undefined") return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.some(isAnswered);
  if (typeof value === "object") return Object.values(value).some(isAnswered);
  return true;
}

function formatNumber(value: number) {
  return NUMBER_FORMAT.format(value);
}

function roundPercentage(count: number, denominator: number) {
  return denominator > 0 ? Math.round((count / denominator) * 1000) / 10 : 0;
}

function median(values: number[]) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

function getQuestions(schema: SurveySchema) {
  const questions: QuestionDescriptor[] = [];
  let visited = 0;

  const visit = (value: unknown, path: string[], depth: number) => {
    if (!isRecord(value) || depth > 32 || visited > 10_000) return;
    visited += 1;
    const type = typeof value.type === "string" ? value.type : "";
    const name = typeof value.name === "string" ? value.name : "";
    const questionPath = name ? [...path, name] : path;

    if (type && name && !STRUCTURAL_TYPES.has(type) && type !== ORGANIZATION_QUESTION_TYPE) {
      questions.push({ question: value as SurveyQuestion, path: questionPath });
    }

    const nestedPath = type === "paneldynamic" && name ? questionPath : path;
    NESTED_KEYS.forEach((key) => {
      const nested = value[key];
      if (Array.isArray(nested)) {
        nested.forEach((item) => visit(item, nestedPath, depth + 1));
      }
    });
  };

  (schema.pages ?? []).forEach((page) => visit(page, [], 0));
  return questions;
}

function collectValuesAtPath(data: Record<string, unknown>, path: string[]) {
  let current: unknown[] = [data];

  path.forEach((segment) => {
    const next: unknown[] = [];
    current.forEach((value) => {
      const candidates = Array.isArray(value) ? value : [value];
      candidates.forEach((candidate) => {
        if (isRecord(candidate) && segment in candidate) {
          next.push(candidate[segment]);
        }
      });
    });
    current = next;
  });

  return current;
}

function getResponseValues(responses: SurveyResponse[], descriptor: QuestionDescriptor) {
  return responses.map((response) => collectValuesAtPath(response.data, descriptor.path));
}

function getChoiceLabelMap(items: unknown) {
  const labels = new Map<string, string>();
  if (!Array.isArray(items)) return labels;

  items.forEach((choice) => {
    if (typeof choice === "string" || typeof choice === "number") {
      labels.set(String(choice), String(choice));
      return;
    }
    if (!isRecord(choice)) return;
    const rawValue = choice.value ?? choice.name ?? choice.text;
    if (typeof rawValue === "undefined") return;
    labels.set(String(rawValue), String(choice.text ?? choice.title ?? rawValue));
  });
  return labels;
}

function countValues(
  values: unknown[],
  labelMap = new Map<string, string>(),
  initialValues: Iterable<string> = [],
) {
  const counts = new Map<string, number>();
  for (const value of initialValues) counts.set(value, 0);

  values.forEach((value) => {
    const rawValue = String(value ?? "").trim();
    if (!rawValue) return;
    const label = labelMap.get(rawValue) ?? rawValue;
    counts.set(label, (counts.get(label) ?? 0) + 1);
  });
  return counts;
}

function toReportValues(counts: Map<string, number>, denominator: number, preserveOrder = false) {
  const values = [...counts.entries()].map(([label, count]) => ({
    label,
    count,
    percentage: roundPercentage(count, denominator),
  }));

  return preserveOrder
    ? values
    : values.sort((left, right) => right.count - left.count || left.label.localeCompare(right.label, "ru"));
}

function flattenAnswered(responseValues: unknown[][]) {
  return responseValues.flatMap((values) => values.filter(isAnswered));
}

function getAnsweredCount(responseValues: unknown[][]) {
  return responseValues.filter((values) => values.some(isAnswered)).length;
}

function analyzeChoice(
  question: SurveyQuestion,
  responseValues: unknown[][],
  totalResponses: number,
  multiple: boolean,
) {
  const questionRecord = question as unknown as Record<string, unknown>;
  const labelMap = getChoiceLabelMap(questionRecord.choices);
  if (question.type === "boolean") {
    labelMap.set("true", "Да");
    labelMap.set("false", "Нет");
  }
  const answeredCount = getAnsweredCount(responseValues);
  const rawValues = flattenAnswered(responseValues).flatMap((value) => multiple && Array.isArray(value) ? value : [value]);
  const initialLabels = labelMap.size > 0 ? labelMap.values() : [];
  const counts = countValues(rawValues, labelMap, initialLabels);

  return {
    kind: (multiple ? "multiple-choice" : "single-choice") as ResponseQuestionAnalysisKind,
    answeredCount,
    metrics: [
      { label: "Ответили", value: String(answeredCount) },
      { label: multiple ? "Всего выборов" : "Вариантов ответа", value: String(rawValues.length) },
    ],
    values: toReportValues(counts, multiple ? totalResponses : answeredCount, labelMap.size > 0),
    groups: [],
  };
}

function toNumbers(values: unknown[]) {
  return values
    .map((value) => typeof value === "number" ? value : Number(String(value).replace(",", ".")))
    .filter((value) => Number.isFinite(value));
}

function buildNumericDistribution(values: number[]) {
  if (values.length === 0) return [];
  const sortedUnique = [...new Set(values)].sort((left, right) => left - right);
  if (sortedUnique.length <= 8) {
    return toReportValues(
      countValues(values.map(formatNumber), new Map(), sortedUnique.map(formatNumber)),
      values.length,
      true,
    );
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  const bucketCount = 5;
  const step = (max - min) / bucketCount || 1;
  const counts = new Map<string, number>();
  const labels = Array.from({ length: bucketCount }, (_, index) => {
    const start = min + step * index;
    const end = index === bucketCount - 1 ? max : min + step * (index + 1);
    const label = `${formatNumber(start)}–${formatNumber(end)}`;
    counts.set(label, 0);
    return label;
  });
  values.forEach((value) => {
    const index = Math.min(bucketCount - 1, Math.floor((value - min) / step));
    const label = labels[index];
    counts.set(label, (counts.get(label) ?? 0) + 1);
  });
  return toReportValues(counts, values.length, true);
}

function analyzeNumeric(responseValues: unknown[][], rating = false) {
  const answeredCount = getAnsweredCount(responseValues);
  const numbers = toNumbers(flattenAnswered(responseValues));
  const average = numbers.length > 0 ? numbers.reduce((sum, value) => sum + value, 0) / numbers.length : 0;
  const metrics: ResponseReportMetric[] = numbers.length > 0
    ? [
        { label: "Среднее", value: formatNumber(average) },
        { label: "Медиана", value: formatNumber(median(numbers)) },
        ...(!rating ? [
          { label: "Минимум", value: formatNumber(Math.min(...numbers)) },
          { label: "Максимум", value: formatNumber(Math.max(...numbers)) },
        ] : []),
      ]
    : [{ label: "Числовых ответов", value: "0" }];

  return {
    kind: (rating ? "rating" : "numeric") as ResponseQuestionAnalysisKind,
    answeredCount,
    metrics,
    values: buildNumericDistribution(numbers),
    groups: [],
  };
}

function parseDateValue(value: unknown) {
  const rawValue = String(value ?? "").trim();
  if (!rawValue) return null;
  const timestamp = Date.parse(rawValue.length === 10 ? `${rawValue}T00:00:00` : rawValue);
  return Number.isFinite(timestamp) ? new Date(timestamp) : null;
}

function analyzeDate(responseValues: unknown[][]) {
  const answeredCount = getAnsweredCount(responseValues);
  const dates = flattenAnswered(responseValues).map(parseDateValue).filter((value): value is Date => Boolean(value));
  if (dates.length === 0) {
    return { kind: "date" as const, answeredCount, metrics: [{ label: "Корректных дат", value: "0" }], values: [], groups: [] };
  }
  const timestamps = dates.map((date) => date.getTime());
  const earliest = new Date(Math.min(...timestamps));
  const latest = new Date(Math.max(...timestamps));
  const useMonths = latest.getTime() - earliest.getTime() > 62 * 24 * 60 * 60 * 1000;
  const counts = countValues(dates.map((date) => useMonths ? MONTH_FORMAT.format(date) : DATE_FORMAT.format(date)));

  return {
    kind: "date" as const,
    answeredCount,
    metrics: [
      { label: "Самая ранняя", value: DATE_FORMAT.format(earliest) },
      { label: "Самая поздняя", value: DATE_FORMAT.format(latest) },
    ],
    values: toReportValues(counts, dates.length),
    groups: [],
  };
}

function parseTimeMinutes(value: unknown) {
  const match = String(value ?? "").match(/(?:T|^)(\d{2}):(\d{2})/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  return hours <= 23 && minutes <= 59 ? hours * 60 + minutes : null;
}

function analyzeTime(responseValues: unknown[][]) {
  const answeredCount = getAnsweredCount(responseValues);
  const minutes = flattenAnswered(responseValues)
    .map(parseTimeMinutes)
    .filter((value): value is number => value !== null);
  const labels = ["00:00–05:59", "06:00–11:59", "12:00–17:59", "18:00–23:59"];
  const counts = new Map(labels.map((label) => [label, 0]));
  minutes.forEach((value) => {
    const label = labels[Math.min(3, Math.floor(value / 360))];
    counts.set(label, (counts.get(label) ?? 0) + 1);
  });

  return {
    kind: "time" as const,
    answeredCount,
    metrics: [{ label: "Ответов со временем", value: String(minutes.length) }],
    values: toReportValues(counts, minutes.length, true),
    groups: [],
  };
}

function stringifyAnswer(value: unknown) {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function analyzeText(responseValues: unknown[][]) {
  const answeredCount = getAnsweredCount(responseValues);
  const answers = flattenAnswered(responseValues).map(stringifyAnswer).filter(Boolean);
  const counts = countValues(answers);
  const repeatedCount = [...counts.values()].filter((count) => count > 1).length;

  return {
    kind: "text" as const,
    answeredCount,
    metrics: [
      { label: "Заполнено", value: String(answeredCount) },
      { label: "Уникальных значений", value: String(counts.size) },
      { label: "Повторяющихся значений", value: String(repeatedCount) },
    ],
    values: toReportValues(counts, answers.length),
    groups: [],
  };
}

function analyzeRanking(question: SurveyQuestion, responseValues: unknown[][]) {
  const answeredCount = getAnsweredCount(responseValues);
  const labelMap = getChoiceLabelMap((question as unknown as Record<string, unknown>).choices);
  const positions = new Map<string, number[]>();
  flattenAnswered(responseValues).forEach((value) => {
    if (!Array.isArray(value)) return;
    value.forEach((item, index) => {
      const rawValue = String(item ?? "");
      const label = labelMap.get(rawValue) ?? rawValue;
      positions.set(label, [...(positions.get(label) ?? []), index + 1]);
    });
  });
  const groups = [...positions.entries()]
    .map(([label, values]) => ({
      label,
      metrics: [{ label: "Средняя позиция", value: formatNumber(values.reduce((sum, value) => sum + value, 0) / values.length) }],
      values: toReportValues(countValues(values.map(String)), values.length),
    }))
    .sort((left, right) => Number(left.metrics[0].value.replace(",", ".")) - Number(right.metrics[0].value.replace(",", ".")));

  return {
    kind: "ranking" as const,
    answeredCount,
    metrics: [{ label: "Ранжирований", value: String(answeredCount) }],
    values: [],
    groups,
  };
}

function analyzeMatrix(question: SurveyQuestion, responseValues: unknown[][]) {
  const answeredCount = getAnsweredCount(responseValues);
  const questionRecord = question as unknown as Record<string, unknown>;
  const rowLabels = getChoiceLabelMap(questionRecord.rows);
  const columnLabels = getChoiceLabelMap(questionRecord.columns);
  const grouped = new Map<string, unknown[]>();

  flattenAnswered(responseValues).forEach((value) => {
    if (question.type === "matrixdynamic" && Array.isArray(value)) {
      value.forEach((row) => {
        if (!isRecord(row)) return;
        Object.entries(row).forEach(([column, cell]) => {
          const label = columnLabels.get(column) ?? column;
          grouped.set(label, [...(grouped.get(label) ?? []), cell]);
        });
      });
      return;
    }
    if (!isRecord(value)) return;
    Object.entries(value).forEach(([row, answer]) => {
      const rowLabel = rowLabels.get(row) ?? row;
      if (isRecord(answer)) {
        Object.entries(answer).forEach(([column, cell]) => {
          const columnLabel = columnLabels.get(column) ?? column;
          const label = `${rowLabel} · ${columnLabel}`;
          grouped.set(label, [...(grouped.get(label) ?? []), cell]);
        });
      } else {
        grouped.set(rowLabel, [...(grouped.get(rowLabel) ?? []), answer]);
      }
    });
  });

  const groups = [...grouped.entries()].map(([label, values]) => {
    const answeredValues = values.filter(isAnswered);
    const numbers = toNumbers(answeredValues);
    if (numbers.length === answeredValues.length && numbers.length > 0) {
      return {
        label,
        metrics: [
          { label: "Среднее", value: formatNumber(numbers.reduce((sum, value) => sum + value, 0) / numbers.length) },
          { label: "Медиана", value: formatNumber(median(numbers)) },
        ],
        values: buildNumericDistribution(numbers),
      };
    }
    return {
      label,
      metrics: [{ label: "Ответов", value: String(answeredValues.length) }],
      values: toReportValues(countValues(answeredValues.map(stringifyAnswer)), answeredValues.length),
    };
  });

  return {
    kind: "matrix" as const,
    answeredCount,
    metrics: [{ label: "Заполненных матриц", value: String(answeredCount) }],
    values: [],
    groups,
  };
}

function analyzeAttachment(question: SurveyQuestion, responseValues: unknown[][]) {
  const answeredCount = getAnsweredCount(responseValues);
  const totalItems = flattenAnswered(responseValues).reduce<number>((total, value) => {
    if (question.type === "file") return total + (Array.isArray(value) ? value.length : 1);
    return total + 1;
  }, 0);

  return {
    kind: "attachment" as const,
    answeredCount,
    metrics: [
      { label: question.type === "file" ? "Ответов с файлами" : "Подписей", value: String(answeredCount) },
      ...(question.type === "file" ? [{ label: "Прикреплено файлов", value: String(totalItems) }] : []),
    ],
    values: [],
    groups: [],
  };
}

function getQuestionKind(question: SurveyQuestion) {
  const record = question as unknown as Record<string, unknown>;
  const inputType = typeof record.inputType === "string" ? record.inputType : "";
  if (SINGLE_CHOICE_TYPES.has(question.type)) return "single-choice";
  if (MULTIPLE_CHOICE_TYPES.has(question.type)) return "multiple-choice";
  if (question.type === "number" || question.type === "integer" || inputType === "number") return "numeric";
  if (question.type === "rating") return "rating";
  if (DATE_TYPES.has(question.type) || inputType === "date" || inputType === "datetime-local") return "date";
  if (question.type === "time" || inputType === "time") return "time";
  if (question.type === "ranking") return "ranking";
  if (MATRIX_TYPES.has(question.type)) return "matrix";
  if (question.type === "file" || question.type === "signaturepad") return "attachment";
  return "text";
}

function analyzeQuestion(responses: SurveyResponse[], descriptor: QuestionDescriptor): ResponseQuestionReport {
  const { question } = descriptor;
  const responseValues = getResponseValues(responses, descriptor);
  const kind = getQuestionKind(question);
  const analysis = kind === "single-choice"
    ? analyzeChoice(question, responseValues, responses.length, false)
    : kind === "multiple-choice"
      ? analyzeChoice(question, responseValues, responses.length, true)
      : kind === "numeric"
        ? analyzeNumeric(responseValues)
        : kind === "rating"
          ? analyzeNumeric(responseValues, true)
          : kind === "date"
            ? analyzeDate(responseValues)
            : kind === "time"
              ? analyzeTime(responseValues)
              : kind === "ranking"
                ? analyzeRanking(question, responseValues)
                : kind === "matrix"
                  ? analyzeMatrix(question, responseValues)
                  : kind === "attachment"
                    ? analyzeAttachment(question, responseValues)
                    : analyzeText(responseValues);

  return {
    name: descriptor.path.join("."),
    title: question.title?.trim() || question.name,
    type: question.type,
    kind: analysis.kind,
    answeredCount: analysis.answeredCount,
    missingCount: Math.max(0, responses.length - analysis.answeredCount),
    metrics: analysis.metrics,
    values: analysis.values,
    groups: analysis.groups,
  };
}

export function createResponseReport(
  responses: SurveyResponse[],
  schema: SurveySchema,
  organizations: EducationOrganization[] = [],
): ResponseReport {
  const questionReports = getQuestions(schema).map((descriptor) => analyzeQuestion(responses, descriptor));
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
    const submittedOrganizations = organizations.filter((organization) => submittedIds.has(organization.id));
    organizationCoverage = {
      expectedCount: organizations.length,
      submittedCount: [...submittedIds].filter((id) => expectedIds.has(id)).length,
      submittedOrganizations,
      missingOrganizations: organizations.filter((organization) => !submittedIds.has(organization.id)),
    };
  }

  return {
    totalResponses: responses.length,
    questionReports,
    organizationCoverage,
  };
}
