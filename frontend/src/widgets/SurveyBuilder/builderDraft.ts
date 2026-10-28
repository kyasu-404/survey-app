import type { ITheme } from "survey-core";
import { sanitizeSurveySchema } from "../../entities/survey/model/surveySchemaSecurity";
import { resolveSurveyTheme, sanitizeSurveyTheme } from "../../entities/survey/model/surveyTheme";
import type { SurveySchema } from "../../entities/survey/types";

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

  const storageKey = getSurveyBuilderDraftStorageKey(userId, formId);
  try {
    // Never restore drafts created before owner scoping was introduced.
    window.localStorage.removeItem(getLegacySurveyBuilderDraftStorageKey(formId));
    const rawDraft = window.localStorage.getItem(storageKey);
    if (!rawDraft) return null;
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
    clearSurveyBuilderDraft(userId, formId);
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

  try {
    const payload: BuilderDraftPayload = {
      schema: sanitizeSurveySchema(schema),
      theme: sanitizeSurveyTheme(theme),
      ...(assetFormId ? { assetFormId } : {}),
      ownerId: userId,
      updatedAt: new Date().toISOString(),
    };

    window.localStorage.setItem(getSurveyBuilderDraftStorageKey(userId, formId), JSON.stringify(payload));
  } catch (error) {
    console.warn("Не удалось сохранить черновик конструктора", error);
  }
}

export function clearSurveyBuilderDraft(userId: string, formId?: string) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.removeItem(getSurveyBuilderDraftStorageKey(userId, formId));
    window.localStorage.removeItem(getLegacySurveyBuilderDraftStorageKey(formId));
  } catch (error) {
    console.warn("Не удалось удалить черновик конструктора", error);
  }
}
