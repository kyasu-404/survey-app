import type { SurveyForm, SurveySchema } from "../types";

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
  return `${survey.title} · ${new Date(survey.created_at).toLocaleString()}`;
}
