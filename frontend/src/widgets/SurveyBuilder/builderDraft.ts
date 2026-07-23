import type { ITheme } from "survey-core";
import type { SurveySchema } from "../../entities/survey/types";
import { sanitizeSurveySchema } from "../../entities/survey/model/surveySchemaSecurity";
import { resolveSurveyTheme, sanitizeSurveyTheme } from "../../entities/survey/model/surveyTheme";

const BUILDER_DRAFT_STORAGE_PREFIX = "survey-builder:draft";
const BUILDER_DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

type BuilderDraftPayload = {
  schema: SurveySchema;
  theme?: ITheme;
  assetFormId?: string;
  ownerId: string;
  updatedAt: string;
};

export type SurveyBuilderDraft = {
  schema: SurveySchema;
  theme: ITheme;
  assetFormId?: string;
};

function getLegacySurveyBuilderDraftStorageKey(formId?: string) {
  return `${BUILDER_DRAFT_STORAGE_PREFIX}:${formId ?? "new"}`;
}

export function getSurveyBuilderDraftStorageKey(userId: string, formId?: string) {
  return `${BUILDER_DRAFT_STORAGE_PREFIX}:${userId}:${formId ?? "new"}`;
}

export function loadSurveyBuilderDraft(userId: string, formId?: string): SurveyBuilderDraft | null {
  if (typeof window === "undefined") {
    return null;
  }

  // Never restore drafts created before owner scoping was introduced.
  window.localStorage.removeItem(getLegacySurveyBuilderDraftStorageKey(formId));
  const storageKey = getSurveyBuilderDraftStorageKey(userId, formId);
  const rawDraft = window.localStorage.getItem(storageKey);
  if (!rawDraft) {
    return null;
  }

  try {
    const parsedDraft = JSON.parse(rawDraft) as BuilderDraftPayload;
    const updatedAt = Date.parse(parsedDraft.updatedAt);
    if (
      parsedDraft.ownerId !== userId
      || !Number.isFinite(updatedAt)
      || Date.now() - updatedAt > BUILDER_DRAFT_TTL_MS
    ) {
      window.localStorage.removeItem(storageKey);
      return null;
    }

    return {
      schema: sanitizeSurveySchema(parsedDraft.schema),
      theme: resolveSurveyTheme(parsedDraft.theme),
      assetFormId: typeof parsedDraft.assetFormId === "string" ? parsedDraft.assetFormId : undefined,
    };
  } catch (error) {
    console.warn("Не удалось восстановить черновик конструктора", error);
    window.localStorage.removeItem(storageKey);
  }

  return null;
}

export function saveSurveyBuilderDraft(
  userId: string,
  formId: string | undefined,
  schema: SurveySchema,
  theme?: ITheme,
  assetFormId?: string,
) {
  if (typeof window === "undefined") {
    return;
  }

  const payload: BuilderDraftPayload = {
    schema: sanitizeSurveySchema(schema),
    theme: sanitizeSurveyTheme(theme),
    ...(assetFormId ? { assetFormId } : {}),
    ownerId: userId,
    updatedAt: new Date().toISOString(),
  };

  window.localStorage.setItem(getSurveyBuilderDraftStorageKey(userId, formId), JSON.stringify(payload));
}

export function clearSurveyBuilderDraft(userId: string, formId?: string) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.removeItem(getSurveyBuilderDraftStorageKey(userId, formId));
  window.localStorage.removeItem(getLegacySurveyBuilderDraftStorageKey(formId));
}
