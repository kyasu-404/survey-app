import { supabaseClient } from "./client";
import { SUPABASE_STORAGE_BUCKET } from "../config/env";

function buildStoragePath(formId: string, fileName: string) {
  const ext = fileName.includes(".") ? fileName.slice(fileName.lastIndexOf(".")) : "";
  return `${formId}/${crypto.randomUUID()}${ext}`;
}

export async function uploadFileToStorage(formId: string, file: File) {
  const filePath = buildStoragePath(formId, file.name);

  const { error } = await supabaseClient.storage.from(SUPABASE_STORAGE_BUCKET).upload(filePath, file, {
    upsert: false,
  });

  if (error) {
    throw new Error(`Не удалось загрузить файл: ${error.message}`);
  }

  const { data } = supabaseClient.storage.from(SUPABASE_STORAGE_BUCKET).getPublicUrl(filePath);
  return {
    file,
    url: data.publicUrl,
    path: filePath,
  };
}

export async function removeFileFromStorage(path: string) {
  const { error } = await supabaseClient.storage.from(SUPABASE_STORAGE_BUCKET).remove([path]);

  if (error) {
    throw new Error(`Не удалось удалить файл: ${error.message}`);
  }
}
