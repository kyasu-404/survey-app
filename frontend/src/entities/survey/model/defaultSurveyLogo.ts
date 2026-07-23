import type { SurveySchema } from "../types";
import cardLogoUrl from "../../../img/card_logo.png";
import { sanitizeSurveySchema } from "./surveySchemaSecurity";

export const DEFAULT_SURVEY_LOGO_TOKEN = "__APP_DEFAULT_CARD_LOGO__";

export function resolveDefaultSurveyLogo(schema: SurveySchema): SurveySchema {
  const next = sanitizeSurveySchema(schema);

  if (next.logo === DEFAULT_SURVEY_LOGO_TOKEN) {
    next.logo = cardLogoUrl;
  }

  return next;
}

export function serializeDefaultSurveyLogo(schema: SurveySchema): SurveySchema {
  const next = sanitizeSurveySchema(schema);

  if (next.logo === cardLogoUrl) {
    next.logo = DEFAULT_SURVEY_LOGO_TOKEN;
  }

  return next;
}
