import type { SurveySchema } from "../types";

export function validateSurveySchema(schema: unknown): schema is SurveySchema {
  if (!schema || typeof schema !== "object") return false;

  const candidate = schema as Partial<SurveySchema>;

  if (!Array.isArray(candidate.pages)) return false;

  return candidate.pages.every(
    (page) =>
      page &&
      Array.isArray(page.elements) &&
      page.elements.every(
        (el) =>
          !!el &&
          typeof el.type === "string" &&
          typeof el.name === "string",
      ),
  );
}
