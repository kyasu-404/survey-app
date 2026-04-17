const RESPONSE_DRAFT_STORAGE_PREFIX = "survey-response:draft";
const ANONYMOUS_RESPONSE_DRAFT_ID_KEY = `${RESPONSE_DRAFT_STORAGE_PREFIX}:anonymous-id`;
const RESPONSE_DRAFT_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export type SurveyResponseDraft = {
  data: Record<string, unknown>;
  uiState?: Record<string, unknown>;
  currentPageNo?: number;
};

type StoredSurveyResponseDraft = SurveyResponseDraft & {
  updatedAt: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function getLocalStorage(): Storage | null {
  if (typeof window === "undefined") {
    return null;
  }

  return window.localStorage;
}

function createAnonymousResponseDraftId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `anonymous-${crypto.randomUUID()}`;
  }

  return `anonymous-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function getOrCreateAnonymousResponseDraftId() {
  const storage = getLocalStorage();
  if (!storage) {
    return null;
  }

  try {
    const savedId = storage.getItem(ANONYMOUS_RESPONSE_DRAFT_ID_KEY);
    if (savedId) {
      return savedId;
    }

    const nextId = createAnonymousResponseDraftId();
    storage.setItem(ANONYMOUS_RESPONSE_DRAFT_ID_KEY, nextId);
    return nextId;
  } catch (error) {
    console.warn("Не удалось подготовить анонимный ключ черновика ответа", error);
    return null;
  }
}

function isExpired(updatedAt: string, now = Date.now()) {
  const updatedAtTime = Date.parse(updatedAt);
  return Number.isNaN(updatedAtTime) || now - updatedAtTime > RESPONSE_DRAFT_TTL_MS;
}

function parseStoredDraft(rawDraft: string): StoredSurveyResponseDraft | null {
  const parsedDraft = JSON.parse(rawDraft) as unknown;

  if (!isRecord(parsedDraft) || !isRecord(parsedDraft.data) || typeof parsedDraft.updatedAt !== "string") {
    return null;
  }

  return {
    data: parsedDraft.data,
    uiState: isRecord(parsedDraft.uiState) ? parsedDraft.uiState : undefined,
    currentPageNo: typeof parsedDraft.currentPageNo === "number" ? parsedDraft.currentPageNo : undefined,
    updatedAt: parsedDraft.updatedAt,
  };
}

export function getSurveyResponseDraftStorageKey(formId: string, respondentId?: string) {
  const ownerId = respondentId?.trim() || getOrCreateAnonymousResponseDraftId();
  return ownerId ? `${RESPONSE_DRAFT_STORAGE_PREFIX}:${ownerId}:${formId}` : null;
}

export function loadSurveyResponseDraft(storageKey: string | null): SurveyResponseDraft | null {
  const storage = getLocalStorage();
  if (!storage || !storageKey) {
    return null;
  }

  const rawDraft = storage.getItem(storageKey);
  if (!rawDraft) {
    return null;
  }

  try {
    const parsedDraft = parseStoredDraft(rawDraft);
    if (!parsedDraft || isExpired(parsedDraft.updatedAt)) {
      storage.removeItem(storageKey);
      return null;
    }

    return {
      data: parsedDraft.data,
      uiState: parsedDraft.uiState,
      currentPageNo: parsedDraft.currentPageNo,
    };
  } catch (error) {
    console.warn("Не удалось восстановить черновик ответа", error);
    storage.removeItem(storageKey);
    return null;
  }
}

export function saveSurveyResponseDraft(storageKey: string | null, draft: SurveyResponseDraft) {
  const storage = getLocalStorage();
  if (!storage || !storageKey) {
    return;
  }

  const payload: StoredSurveyResponseDraft = {
    data: draft.data,
    uiState: draft.uiState,
    currentPageNo: typeof draft.currentPageNo === "number" ? draft.currentPageNo : undefined,
    updatedAt: new Date().toISOString(),
  };

  try {
    storage.setItem(storageKey, JSON.stringify(payload));
  } catch (error) {
    console.warn("Не удалось сохранить черновик ответа", error);
  }
}

export function clearSurveyResponseDraft(storageKey: string | null) {
  const storage = getLocalStorage();
  if (!storage || !storageKey) {
    return;
  }

  storage.removeItem(storageKey);
}

export function cleanupExpiredSurveyResponseDrafts() {
  const storage = getLocalStorage();
  if (!storage) {
    return;
  }

  for (let index = storage.length - 1; index >= 0; index -= 1) {
    const storageKey = storage.key(index);
    if (
      !storageKey ||
      storageKey === ANONYMOUS_RESPONSE_DRAFT_ID_KEY ||
      !storageKey.startsWith(`${RESPONSE_DRAFT_STORAGE_PREFIX}:`)
    ) {
      continue;
    }

    const rawDraft = storage.getItem(storageKey);
    if (!rawDraft) {
      continue;
    }

    try {
      const parsedDraft = parseStoredDraft(rawDraft);
      if (!parsedDraft || isExpired(parsedDraft.updatedAt)) {
        storage.removeItem(storageKey);
      }
    } catch {
      storage.removeItem(storageKey);
    }
  }
}
