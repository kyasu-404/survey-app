import { supabaseClient } from "./client";
import { SUPABASE_STORAGE_BUCKET } from "../config/env";

const SIGNED_URL_EXPIRES_IN_SECONDS = 60 * 60 * 24 * 7;

function getFileExtension(fileName: string) {
  const cleanName = fileName.split(/[\\/]/).pop() ?? "";
  const dotIndex = cleanName.lastIndexOf(".");

  if (dotIndex === -1) {
    return "";
  }

  return cleanName.slice(dotIndex).replace(/[^a-zA-Z0-9.]/g, "");
}

function buildStoragePath(userId: string, formId: string, fileName: string) {
  return `${userId}/${formId}/${crypto.randomUUID()}${getFileExtension(fileName)}`;
}

async function getCurrentUserId() {
  const {
    data: { user },
    error,
  } = await supabaseClient.auth.getUser();

  if (error) {
    throw new Error(`Не удалось проверить пользователя: ${error.message}`);
  }

  if (!user?.id) {
    throw new Error("Пользователь не авторизован для загрузки файлов");
  }

  return user.id;
}

function assertOwnedPath(path: string, userId: string) {
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
    return getStoragePathByUrl(value);
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
    return getStoragePathByUrl(fileValue.content);
  }

  return null;
}

export async function uploadFileToStorage(formId: string, file: File) {
  const currentUserId = await getCurrentUserId();
  const filePath = buildStoragePath(currentUserId, formId, file.name);
  const bucket = supabaseClient.storage.from(SUPABASE_STORAGE_BUCKET);

  const { error } = await bucket.upload(filePath, file, {
    upsert: false,
  });

  if (error) {
    throw new Error(`Не удалось загрузить файл: ${error.message}`);
  }

  const { data, error: signedUrlError } = await bucket.createSignedUrl(filePath, SIGNED_URL_EXPIRES_IN_SECONDS);

  if (signedUrlError || !data?.signedUrl) {
    throw new Error(`Не удалось создать ссылку на файл: ${signedUrlError?.message ?? "пустой ответ"}`);
  }

  return {
    file,
    url: data.signedUrl,
    path: filePath,
  };
}

export async function removeFileFromStorage(path: string) {
  const currentUserId = await getCurrentUserId();
  assertOwnedPath(path, currentUserId);

  const { error } = await supabaseClient.storage.from(SUPABASE_STORAGE_BUCKET).remove([path]);

  if (error) {
    throw new Error(`Не удалось удалить файл: ${error.message}`);
  }
}
