import type { SurveySchema } from "../types";
import cardLogoUrl from "../../../img/card_logo.png";
import {
  resolveManagedSurveyAssetUrl,
  serializeManagedSurveyAssetUrl,
} from "../../../shared/api/surveyAssetUrls";
import { sanitizeSurveySchema } from "./surveySchemaSecurity";

export const DEFAULT_SURVEY_LOGO_TOKEN = "__APP_DEFAULT_CARD_LOGO__";

function prepareLogoForSanitizing(schema: SurveySchema) {
  const next = { ...schema };

  if (typeof next.logo !== "string") {
    return next;
  }

  if (next.logo === cardLogoUrl) {
    next.logo = DEFAULT_SURVEY_LOGO_TOKEN;
    return next;
  }

  const serializedLogo = serializeManagedSurveyAssetUrl(next.logo);
  if (serializedLogo === null) {
    delete next.logo;
  } else {
    next.logo = serializedLogo;
  }

  return next;
}

export function resolveDefaultSurveyLogo(schema: SurveySchema): SurveySchema {
  const next = sanitizeSurveySchema(prepareLogoForSanitizing(schema));

  if (next.logo === DEFAULT_SURVEY_LOGO_TOKEN) {
    next.logo = cardLogoUrl;
  } else if (typeof next.logo === "string") {
    const resolvedLogo = resolveManagedSurveyAssetUrl(next.logo);
    if (resolvedLogo === null) {
      delete next.logo;
    } else {
      next.logo = resolvedLogo;
    }
  }

  return next;
}

export function serializeDefaultSurveyLogo(schema: SurveySchema): SurveySchema {
  return sanitizeSurveySchema(prepareLogoForSanitizing(schema));
}
