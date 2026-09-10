import type { SurveySchema } from "../types";
import cardLogoUrl from "../../../img/card_logo.png";
import {
  resolveManagedSurveyAssetUrl,
  serializeManagedSurveyAssetUrl,
} from "../../../shared/api/surveyAssetUrls";
import { PASSIVE_ASSET_URL_KEYS, sanitizeSurveySchema } from "./surveySchemaSecurity";

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

  const pending: Array<Record<string, unknown>> = [next as unknown as Record<string, unknown>];
  for (let index = 0; index < pending.length; index += 1) {
    const item = pending[index];
    for (const [key, value] of Object.entries(item)) {
      if (value && typeof value === "object") pending.push(value as Record<string, unknown>);
      if (PASSIVE_ASSET_URL_KEYS.has(key) && typeof value === "string") {
        const resolved = resolveManagedSurveyAssetUrl(value);
        if (resolved === null) delete item[key];
        else item[key] = resolved;
      }
    }
  }

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
