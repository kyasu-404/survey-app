import type { SurveyResponse } from "../types";

export type SurveySubmitPayload = {
  formId: string;
  answers: Record<string, unknown>;
};

export function createSubmitPayload(
  formId: string,
  answers: Record<string, unknown>,
): SurveySubmitPayload {
  return {
    formId,
    answers,
  };
}

export function getResponseCountLabel(responses: SurveyResponse[]): string {
  return `Ответов: ${responses.length}`;
}
