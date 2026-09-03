import type { SurveySchema } from "../types";
import { sanitizeSurveySchema } from "./surveySchemaSecurity";

type JsonObject = Record<string, unknown>;

type SurveyElementLike = JsonObject & {
  type?: string;
  showNumber?: boolean;
  hideNumber?: boolean;
  showQuestionNumbers?: string | boolean;
  elements?: unknown[];
  templateElements?: unknown[];
  pages?: Array<{ elements?: unknown[] }>;
};

type SurveySchemaWithNumbering = SurveySchema & {
  showQuestionNumbers?: boolean | string;
  pages?: Array<{ elements?: unknown[] }>;
};

function isRecord(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function visitElements(elements: unknown[]) {
  elements.forEach((element) => {
    if (!isRecord(element)) {
      return;
    }

    const surveyElement = element as SurveyElementLike;

    if ("hideNumber" in surveyElement) {
      delete surveyElement.hideNumber;
    }

    surveyElement.showNumber = false;

    if (surveyElement.type === "panel" || surveyElement.type === "paneldynamic") {
      surveyElement.showQuestionNumbers = "off";
    }

    if (Array.isArray(surveyElement.elements)) {
      visitElements(surveyElement.elements);
    }

    if (Array.isArray(surveyElement.templateElements)) {
      visitElements(surveyElement.templateElements);
    }

    if (Array.isArray(surveyElement.pages)) {
      surveyElement.pages.forEach((page) => {
        if (page && Array.isArray(page.elements)) {
          visitElements(page.elements);
        }
      });
    }
  });
}

export function normalizeSurveyQuestionNumbers<T extends SurveySchema>(schema: T): T {
  const normalizedSchema = sanitizeSurveySchema(schema) as T & SurveySchemaWithNumbering;

  normalizedSchema.showQuestionNumbers = false;

  normalizedSchema.pages?.forEach((page) => {
    if (Array.isArray(page.elements)) {
      visitElements(page.elements);
    }
  });

  return normalizedSchema;
}
