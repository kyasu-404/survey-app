import { isAuthError, isAuthSessionMissingError } from "@supabase/supabase-js";
import { publicSupabaseClient, supabaseClient } from "./client";
import { SUPABASE_STORAGE_BUCKET } from "../config/env";

const SIGNED_URL_EXPIRES_IN_SECONDS = 60 * 60 * 24 * 7;
const PUBLIC_STORAGE_PREFIX = "public";

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
  } = await supabaseClient.auth.getUser();

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
    // eslint-disable-next-line no-new
    new URL(value);
    return false;
  } catch {
    return value.split("/").filter(Boolean).length >= 3;
  }
}

function assertDeletablePath(path: string, userId: string | null, options: RemoveFileFromStorageOptions) {
  if (path.startsWith(`${PUBLIC_STORAGE_PREFIX}/`)) {
    throw new Error("Публичные файлы удаляются только сервером");
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

    return decodeURIComponent(pathWithBucket.slice(firstSlash + 1));
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
    return fileValue.storagePath;
  }

  if (typeof fileValue.path === "string") {
    return fileValue.path;
  }

  if (typeof fileValue.content === "string") {
    return getStoragePathByUrl(fileValue.content) ?? (looksLikeStoragePath(fileValue.content) ? fileValue.content : null);
  }

  return null;
}

async function createSignedUrlForStoragePath(path: string) {
  const bucket = supabaseClient.storage.from(SUPABASE_STORAGE_BUCKET);
  const { data, error } = await bucket.createSignedUrl(path, SIGNED_URL_EXPIRES_IN_SECONDS);

  if (error || !data?.signedUrl) {
    throw new Error(`Не удалось создать ссылку на файл: ${error?.message ?? "пустой ответ"}`);
  }

  return data.signedUrl;
}

export async function resolveSurveyFileValueContent(value: unknown) {
  const storagePath = getStoragePathFromSurveyFileValue(value);

  if (storagePath) {
    return createSignedUrlForStoragePath(storagePath);
  }

  if (typeof value === "string") {
    return value;
  }

  if (value && typeof value === "object" && "content" in value && typeof value.content === "string") {
    return value.content;
  }

  throw new Error("Не удалось определить содержимое файла");
}

export async function uploadFileToStorage(formId: string, file: File, options: UploadFileToStorageOptions = {}) {
  const currentUserId = await getCurrentUserId(options);

  if (!currentUserId && !options.allowAnonymous) {
    throw new Error("Пользователь не авторизован для загрузки файлов");
  }

  const filePath = currentUserId
    ? buildUserStoragePath(currentUserId, formId, file.name)
    : buildPublicStoragePath(formId, file.name);
  const bucketClient = currentUserId ? supabaseClient : publicSupabaseClient;
  const bucket = bucketClient.storage.from(SUPABASE_STORAGE_BUCKET);

  const { error } = await bucket.upload(filePath, file, {
    upsert: false,
  });

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

  const bucketClient = currentUserId ? supabaseClient : publicSupabaseClient;
  const { error } = await bucketClient.storage.from(SUPABASE_STORAGE_BUCKET).remove([path]);

  if (error) {
    throw new Error(`Не удалось удалить файл: ${error.message}`);
  }
}
