import type { SurveyForm, SurveySchema } from "../types";
import { DEFAULT_SURVEY_LOGO_TOKEN } from "./defaultSurveyLogo";

export const TEMPLATE_FORM_TYPE = "template";
export const DEFAULT_COMPLETED_HTML =
  "<div class='survey-complete-message'>Спасибо за Ваш ответ!</div>";

export function createEmptySurveySchema(title = "Новая форма"): SurveySchema {
  return {
    title,
    completedHtml: DEFAULT_COMPLETED_HTML,
    questionDescriptionLocation: "underTitle",
    logo: DEFAULT_SURVEY_LOGO_TOKEN,
    logoWidth: "120px",
    logoHeight: "90px",
    logoFit: "contain",
    pages: [
      {
        name: "page1",
        title: "",
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
