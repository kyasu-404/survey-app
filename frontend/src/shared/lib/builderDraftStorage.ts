const BUILDER_DRAFT_STORAGE_PREFIX = "survey-builder:draft";

export function getLegacySurveyBuilderDraftStorageKey(formId?: string) {
  return `${BUILDER_DRAFT_STORAGE_PREFIX}:${formId ?? "new"}`;
}

export function getSurveyBuilderDraftStorageKey(userId: string, formId?: string) {
  return `${BUILDER_DRAFT_STORAGE_PREFIX}:${userId}:${formId ?? "new"}`;
}

export function clearSurveyBuilderDraftsForUser(userId: string) {
  const prefix = `${BUILDER_DRAFT_STORAGE_PREFIX}:${userId}:`;
  try {
    const storage = window.localStorage;
    for (let index = storage.length - 1; index >= 0; index -= 1) {
      const key = storage.key(index);
      if (key?.startsWith(prefix)) storage.removeItem(key);
    }
  } catch {
    // Storage can be unavailable in privacy mode.
  }
}
