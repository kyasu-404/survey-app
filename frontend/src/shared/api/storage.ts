import { isAuthError, isAuthSessionMissingError } from "@supabase/supabase-js";
import { publicSupabaseClient, supabaseClient } from "./client";
import { runRequest } from "./request";
import { SUPABASE_STORAGE_BUCKET, SUPABASE_URL } from "../config/env";

const SIGNED_URL_EXPIRES_IN_SECONDS = 60 * 60 * 24 * 7;
const PUBLIC_STORAGE_PREFIX = "public";
const MAX_STORAGE_FILE_SIZE_BYTES = 10 * 1024 * 1024;

type StorageAuthOptions = {
  allowAnonymous?: boolean;
};

type UploadFileToStorageOptions = StorageAuthOptions;

type RemoveFileFromStorageOptions = {
  allowAnonymous?: boolean;
  formId?: string;
};

function getFileExtension(fileName: string) {
  const cleanName = fileName.split(/[\\/]/).pop() ?? "";
  const dotIndex = cleanName.lastIndexOf(".");

  if (dotIndex === -1) {
    return "";
  }

  return cleanName.slice(dotIndex).replace(/[^a-zA-Z0-9.]/g, "");
}

function generateStorageObjectId() {
  if (typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  if (typeof crypto.getRandomValues === "function") {
    const bytes = crypto.getRandomValues(new Uint8Array(16));

    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;

    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"));
    return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10, 16).join("")}`;
  }

  return `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

function buildUserStoragePath(userId: string, formId: string, fileName: string) {
  return `${userId}/${formId}/${generateStorageObjectId()}${getFileExtension(fileName)}`;
}

function buildPublicStoragePath(formId: string, fileName: string) {
  return `${PUBLIC_STORAGE_PREFIX}/${formId}/${generateStorageObjectId()}${getFileExtension(fileName)}`;
}

async function getCurrentUserId(options: StorageAuthOptions = {}) {
  const {
    data: { user },
    error,
  } = await runRequest(
    "auth.getStorageUser",
    () => supabaseClient.auth.getUser(),
    { context: { allowAnonymous: Boolean(options.allowAnonymous) } },
  );

  if (error) {
    if (isAuthSessionMissingError(error)) {
      return null;
    }

    // Public form uploads should keep working even if the browser has a stale
    // persisted session from another part of the app.
    if (options.allowAnonymous && isAuthError(error)) {
      return null;
    }

    throw new Error(`Не удалось проверить пользователя: ${error.message}`);
  }

  return user?.id ?? null;
}

function looksLikeStoragePath(value: string) {
  if (!value || value.startsWith("data:")) {
    return false;
  }

  try {
    // Fully qualified URLs are handled separately.
    new URL(value);
    return false;
  } catch {
    const parts = value.split("/");
    return (
      parts.length === 3
      && parts.every((part) => part.length > 0)
      && parts[2].length <= 512
      && (parts[0] === PUBLIC_STORAGE_PREFIX || /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(parts[0]))
      && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(parts[1])
    );
  }
}

function assertDeletablePath(path: string, userId: string | null, options: RemoveFileFromStorageOptions) {
  if (path.startsWith(`${PUBLIC_STORAGE_PREFIX}/`)) {
    if (options.allowAnonymous && options.formId && path.startsWith(`${PUBLIC_STORAGE_PREFIX}/${options.formId}/`)) {
      return;
    }
    throw new Error("Нельзя удалить публичный файл другой формы");
  }

  if (userId && path.startsWith(`${userId}/`)) {
    return;
  }

  if (!userId) {
    throw new Error("Пользователь не авторизован для удаления файлов");
  }

  if (options.allowAnonymous && options.formId) {
    throw new Error("Нельзя удалить файл другой формы");
  }

  if (!path.startsWith(`${userId}/`)) {
    throw new Error("Нельзя удалить файл другого пользователя");
  }
}

function getStoragePathByUrl(url: string) {
  try {
    const parsedUrl = new URL(url);
    if (parsedUrl.origin !== new URL(SUPABASE_URL).origin || parsedUrl.username || parsedUrl.password) {
      return null;
    }
    const marker = parsedUrl.pathname.includes("/object/sign/") ? "/object/sign/" : "/object/public/";
    const markerIndex = parsedUrl.pathname.indexOf(marker);

    if (markerIndex === -1) {
      return null;
    }

    const pathWithBucket = parsedUrl.pathname.slice(markerIndex + marker.length);
    const firstSlash = pathWithBucket.indexOf("/");

    if (firstSlash === -1) {
      return null;
    }

    const bucket = decodeURIComponent(pathWithBucket.slice(0, firstSlash));
    const path = decodeURIComponent(pathWithBucket.slice(firstSlash + 1));
    return bucket === SUPABASE_STORAGE_BUCKET && looksLikeStoragePath(path) ? path : null;
  } catch {
    return null;
  }
}

export function getStoragePathFromSurveyFileValue(value: unknown) {
  if (typeof value === "string") {
    return getStoragePathByUrl(value) ?? (looksLikeStoragePath(value) ? value : null);
  }

  if (!value || typeof value !== "object") {
    return null;
  }

  const fileValue = value as { content?: unknown; path?: unknown; storagePath?: unknown };

  if (typeof fileValue.storagePath === "string") {
    return looksLikeStoragePath(fileValue.storagePath) ? fileValue.storagePath : null;
  }

  if (typeof fileValue.path === "string") {
    return looksLikeStoragePath(fileValue.path) ? fileValue.path : null;
  }

  if (typeof fileValue.content === "string") {
    return getStoragePathByUrl(fileValue.content) ?? (looksLikeStoragePath(fileValue.content) ? fileValue.content : null);
  }

  return null;
}

export function getStoragePathsFromResponseData(data: Record<string, unknown>) {
  const paths = new Set<string>();
  const pending: unknown[] = [data];
  let visitedNodes = 0;

  while (pending.length > 0 && visitedNodes < 10_000) {
    const value = pending.pop();
    visitedNodes += 1;

    const storagePath = getStoragePathFromSurveyFileValue(value);
    if (storagePath) {
      paths.add(storagePath);
      continue;
    }

    if (Array.isArray(value)) {
      pending.push(...value);
      continue;
    }

    if (value && typeof value === "object") {
      pending.push(...Object.values(value));
    }
  }

  return [...paths];
}

async function createSignedUrlForStoragePath(path: string) {
  const bucket = supabaseClient.storage.from(SUPABASE_STORAGE_BUCKET);
  const { data, error } = await runRequest(
    "storage.createSignedUrl",
    () => bucket.createSignedUrl(path, SIGNED_URL_EXPIRES_IN_SECONDS),
    {
      context: {
        bucket: SUPABASE_STORAGE_BUCKET,
        expiresInSeconds: SIGNED_URL_EXPIRES_IN_SECONDS,
      },
    },
  );

  if (error || !data?.signedUrl) {
    throw new Error(`Не удалось создать ссылку на файл: ${error?.message ?? "пустой ответ"}`);
  }

  return data.signedUrl;
}

function arrayBufferToBase64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = "";

  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize);
    binary += String.fromCharCode(...chunk);
  }

  return btoa(binary);
}

async function fetchStorageFileAsDataUrl(path: string) {
  const signedUrl = await createSignedUrlForStoragePath(path);
  const response = await runRequest(
    "storage.downloadSignedFile",
    (signal) => fetch(signedUrl, { signal }),
    {
      context: {
        bucket: SUPABASE_STORAGE_BUCKET,
        path,
      },
    },
  );

  if (!response.ok) {
    throw new Error(`Не удалось скачать файл: ${response.status} ${response.statusText}`.trim());
  }

  const blob = await response.blob();
  const mimeType = blob.type || response.headers.get("Content-Type") || "application/octet-stream";
  const base64 = arrayBufferToBase64(await blob.arrayBuffer());

  return `data:${mimeType};base64,${base64}`;
}

export async function resolveSurveyFileValueContent(value: unknown) {
  const storagePath = getStoragePathFromSurveyFileValue(value);

  if (storagePath) {
    return fetchStorageFileAsDataUrl(storagePath);
  }

  throw new Error("Не удалось определить содержимое файла");
}

export async function uploadFileToStorage(formId: string, file: File, options: UploadFileToStorageOptions = {}) {
  if (file.size > MAX_STORAGE_FILE_SIZE_BYTES) {
    throw new Error("Размер файла превышает допустимые 10 МБ");
  }

  const currentUserId = await getCurrentUserId(options);

  if (!currentUserId && !options.allowAnonymous) {
    throw new Error("Пользователь не авторизован для загрузки файлов");
  }

  const filePath = currentUserId
    ? buildUserStoragePath(currentUserId, formId, file.name)
    : buildPublicStoragePath(formId, file.name);
  const bucketClient = currentUserId ? supabaseClient : publicSupabaseClient;
  const bucket = bucketClient.storage.from(SUPABASE_STORAGE_BUCKET);

  const { error } = await runRequest(
    "storage.upload",
    () =>
      bucket.upload(filePath, file, {
        upsert: false,
      }),
    {
      context: {
        bucket: SUPABASE_STORAGE_BUCKET,
        formId,
        allowAnonymous: Boolean(options.allowAnonymous),
        fileSize: file.size,
        fileType: file.type || null,
      },
    },
  );

  if (error) {
    throw new Error(`Не удалось загрузить файл: ${error.message}`);
  }

  return {
    file,
    path: filePath,
  };
}

export async function removeFileFromStorage(path: string, options: RemoveFileFromStorageOptions = {}) {
  const currentUserId = await getCurrentUserId(options);
  assertDeletablePath(path, currentUserId, options);

  if (path.startsWith(`${PUBLIC_STORAGE_PREFIX}/`)) {
    const { error } = await runRequest(
      "storage.removeAnonymousUpload",
      () => publicSupabaseClient.functions.invoke("form-admin", {
        body: { action: "delete-upload", formId: options.formId, path },
      }),
      { context: { bucket: SUPABASE_STORAGE_BUCKET, formId: options.formId ?? null } },
    );
    if (error) {
      throw new Error(`Не удалось удалить файл: ${error.message}`);
    }
    return;
  }

  const bucketClient = currentUserId ? supabaseClient : publicSupabaseClient;
  const { error } = await runRequest(
    "storage.remove",
    () => bucketClient.storage.from(SUPABASE_STORAGE_BUCKET).remove([path]),
    {
      context: {
        bucket: SUPABASE_STORAGE_BUCKET,
        formId: options.formId ?? null,
        allowAnonymous: Boolean(options.allowAnonymous),
      },
    },
  );

  if (error) {
    throw new Error(`Не удалось удалить файл: ${error.message}`);
  }
}
