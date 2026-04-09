import type { SurveySchema } from "../../entities/survey/types";

const BUILDER_DRAFT_STORAGE_PREFIX = "survey-builder:draft";

type BuilderDraftPayload = {
  schema: SurveySchema;
  updatedAt: string;
};

export function getSurveyBuilderDraftStorageKey(formId?: string) {
  return `${BUILDER_DRAFT_STORAGE_PREFIX}:${formId ?? "new"}`;
}

export function loadSurveyBuilderDraft(formId?: string): SurveySchema | null {
  if (typeof window === "undefined") {
    return null;
  }

  const rawDraft = window.localStorage.getItem(getSurveyBuilderDraftStorageKey(formId));
  if (!rawDraft) {
    return null;
  }

  try {
    const parsedDraft = JSON.parse(rawDraft) as BuilderDraftPayload | SurveySchema;

    if (parsedDraft && typeof parsedDraft === "object" && "schema" in parsedDraft) {
      return parsedDraft.schema;
    }

    if (parsedDraft && typeof parsedDraft === "object" && "pages" in parsedDraft) {
      return parsedDraft as SurveySchema;
    }
  } catch (error) {
    console.warn("Не удалось восстановить черновик конструктора", error);
  }

  return null;
}

export function saveSurveyBuilderDraft(formId: string | undefined, schema: SurveySchema) {
  if (typeof window === "undefined") {
    return;
  }

  const payload: BuilderDraftPayload = {
    schema,
    updatedAt: new Date().toISOString(),
  };

  window.localStorage.setItem(getSurveyBuilderDraftStorageKey(formId), JSON.stringify(payload));
}

export function clearSurveyBuilderDraft(formId?: string) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.removeItem(getSurveyBuilderDraftStorageKey(formId));
}
