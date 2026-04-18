const RESPONSE_DRAFT_STORAGE_PREFIX = "survey-response:draft";
const ANONYMOUS_RESPONSE_DRAFT_ID_KEY = `${RESPONSE_DRAFT_STORAGE_PREFIX}:anonymous-id`;
const RESPONSE_DRAFT_TTL_MS = 8 * 60 * 60 * 1000;

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

function getSessionStorage(): Storage | null {
  if (typeof window === "undefined") {
    return null;
  }

  return window.sessionStorage;
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
  const storage = getSessionStorage();
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

function looksLikeDraftStoragePath(value: string) {
  if (!value || value.startsWith("data:")) {
    return false;
  }

  try {
    const parsedUrl = new URL(value);
    return parsedUrl.pathname.includes("/object/sign/") || parsedUrl.pathname.includes("/object/public/");
  } catch {
    const parts = value.split("/").filter(Boolean);
    return parts.length >= 3 && (parts[0] === "public" || /^[0-9a-f-]{16,}$/i.test(parts[0]));
  }
}

function isBrowserFile(value: unknown): value is File {
  return typeof File !== "undefined" && value instanceof File;
}

function isSurveyFileValue(value: unknown) {
  if (isBrowserFile(value)) {
    return true;
  }

  if (!isRecord(value)) {
    return typeof value === "string" && looksLikeDraftStoragePath(value);
  }

  if (isBrowserFile(value.file)) {
    return true;
  }

  if (typeof value.content === "string" && value.content.startsWith("data:")) {
    return true;
  }

  return [value.content, value.path, value.storagePath].some(
    (filePath) => typeof filePath === "string" && looksLikeDraftStoragePath(filePath),
  );
}

function sanitizeDraftValue(value: unknown): unknown {
  if (isSurveyFileValue(value)) {
    return undefined;
  }

  if (Array.isArray(value)) {
    const sanitizedItems = value
      .map((item) => sanitizeDraftValue(item))
      .filter((item) => typeof item !== "undefined");

    return sanitizedItems.length > 0 ? sanitizedItems : undefined;
  }

  if (isRecord(value)) {
    const sanitizedEntries = Object.entries(value)
      .map(([key, nestedValue]) => [key, sanitizeDraftValue(nestedValue)] as const)
      .filter(([, nestedValue]) => typeof nestedValue !== "undefined");

    return sanitizedEntries.length > 0 ? Object.fromEntries(sanitizedEntries) : undefined;
  }

  return value;
}

function sanitizeDraftData(data: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(data)
      .map(([key, value]) => [key, sanitizeDraftValue(value)] as const)
      .filter(([, value]) => typeof value !== "undefined"),
  );
}

function removeResponseDraftKeys(storage: Storage, predicate: (storageKey: string) => boolean) {
  for (let index = storage.length - 1; index >= 0; index -= 1) {
    const storageKey = storage.key(index);

    if (storageKey && predicate(storageKey)) {
      storage.removeItem(storageKey);
    }
  }
}

export function getSurveyResponseDraftStorageKey(formId: string, respondentId?: string) {
  const ownerId = respondentId?.trim() || getOrCreateAnonymousResponseDraftId();
  return ownerId ? `${RESPONSE_DRAFT_STORAGE_PREFIX}:${ownerId}:${formId}` : null;
}

export function loadSurveyResponseDraft(storageKey: string | null): SurveyResponseDraft | null {
  const storage = getSessionStorage();
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
  const storage = getSessionStorage();
  if (!storage || !storageKey) {
    return;
  }

  const payload: StoredSurveyResponseDraft = {
    data: sanitizeDraftData(draft.data),
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
  const storage = getSessionStorage();
  if (!storageKey) {
    return;
  }

  storage?.removeItem(storageKey);
  getLocalStorage()?.removeItem(storageKey);
}

export function cleanupExpiredSurveyResponseDrafts() {
  const localStorage = getLocalStorage();
  if (localStorage) {
    removeResponseDraftKeys(
      localStorage,
      (storageKey) =>
        storageKey === ANONYMOUS_RESPONSE_DRAFT_ID_KEY || storageKey.startsWith(`${RESPONSE_DRAFT_STORAGE_PREFIX}:`),
    );
  }

  const storage = getSessionStorage();
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
