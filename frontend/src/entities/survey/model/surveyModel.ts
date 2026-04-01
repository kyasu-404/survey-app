import type { SurveyForm, SurveySchema } from "../types";

export const TEMPLATE_FORM_TYPE = "template";

export function createEmptySurveySchema(title = "Новая форма"): SurveySchema {
  return {
    title,
    pages: [
      {
        name: "page1",
        title: "Страница 1",
        elements: [],
      },
    ],
  };
}

export function getSurveyDisplayTitle(survey: Pick<SurveyForm, "title" | "created_at">): string {
  return survey.title;
}

export function isTemplateForm(survey: Pick<SurveyForm, "form_type">): boolean {
  return survey.form_type === TEMPLATE_FORM_TYPE;
}
