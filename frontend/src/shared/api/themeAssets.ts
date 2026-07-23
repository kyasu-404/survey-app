import type { ITheme } from "survey-core";
import { sanitizeSurveyTheme } from "../../entities/survey/model/surveyTheme";
import { SUPABASE_URL } from "../config/env";
import { runRequest } from "./request";
import { supabaseClient } from "./client";

export const SURVEY_ASSETS_BUCKET = "survey-assets";
export const MAX_SURVEY_BACKGROUND_SIZE_BYTES = 5 * 1024 * 1024;
export const SURVEY_BACKGROUND_ACCEPT = "image/jpeg,image/png,image/webp";

const ALLOWED_IMAGE_TYPES = new Set(SURVEY_BACKGROUND_ACCEPT.split(","));

export type SurveyBackgroundAsset = {
  id: string;
  name: string;
  url: string;
  source: "common" | "custom";
};

export const BUILT_IN_SURVEY_BACKGROUNDS: SurveyBackgroundAsset[] = [
  { id: "aurora", name: "Северное сияние", url: "/theme-backgrounds/aurora.svg", source: "common" },
  { id: "paper", name: "Бумага", url: "/theme-backgrounds/paper.svg", source: "common" },
  { id: "waves", name: "Мягкие волны", url: "/theme-backgrounds/waves.svg", source: "common" },
  { id: "geometry", name: "Геометрия", url: "/theme-backgrounds/geometry.svg", source: "common" },
];

function generateUuid() {
  if (typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"));
  return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10).join("")}`;
}

function getImageExtension(file: File) {
  const byType: Record<string, string> = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
  };
  return byType[file.type] ?? "";
}

function getPublicAssetUrl(path: string) {
  return supabaseClient.storage.from(SURVEY_ASSETS_BUCKET).getPublicUrl(path).data.publicUrl;
}

export function createSurveyAssetFormId() {
  return generateUuid();
}

export function validateSurveyBackgroundFile(file: File) {
  if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
    throw new Error("Поддерживаются только JPG, PNG и WebP");
  }
  if (file.size <= 0 || file.size > MAX_SURVEY_BACKGROUND_SIZE_BYTES) {
    throw new Error("Размер изображения должен быть не больше 5 МБ");
  }
}

export async function uploadSurveyBackground(formId: string, ownerId: string, file: File) {
  validateSurveyBackgroundFile(file);
  const path = `forms/${formId}/${ownerId}/${generateUuid()}${getImageExtension(file)}`;
  const bucket = supabaseClient.storage.from(SURVEY_ASSETS_BUCKET);
  const { error } = await runRequest(
    "surveyAssets.upload",
    () => bucket.upload(path, file, { cacheControl: "31536000", contentType: file.type, upsert: false }),
    { context: { bucket: SURVEY_ASSETS_BUCKET, formId, fileSize: file.size, fileType: file.type } },
  );

  if (error) {
    throw new Error(`Не удалось загрузить фон: ${error.message}`);
  }

  return { path, url: getPublicAssetUrl(path) };
}

function mapListedAsset(prefix: string, name: string, source: SurveyBackgroundAsset["source"]): SurveyBackgroundAsset {
  const path = `${prefix}/${name}`;
  return { id: path, name, url: getPublicAssetUrl(path), source };
}

export async function listCommonSurveyBackgrounds() {
  const bucket = supabaseClient.storage.from(SURVEY_ASSETS_BUCKET);
  const { data, error } = await runRequest(
    "surveyAssets.listCommon",
    () => bucket.list("gallery", { limit: 100, sortBy: { column: "name", order: "asc" } }),
    { context: { bucket: SURVEY_ASSETS_BUCKET } },
  );
  if (error) throw new Error(`Не удалось загрузить общую галерею: ${error.message}`);

  const remoteAssets = (data ?? [])
    .filter((item) => item.id && item.name && !item.name.startsWith("."))
    .map((item) => mapListedAsset("gallery", item.name, "common"));

  return [...BUILT_IN_SURVEY_BACKGROUNDS, ...remoteAssets];
}

export async function listCustomSurveyBackgrounds(formId: string, ownerId: string) {
  const prefix = `forms/${formId}/${ownerId}`;
  const bucket = supabaseClient.storage.from(SURVEY_ASSETS_BUCKET);
  const { data, error } = await runRequest(
    "surveyAssets.listCustom",
    () => bucket.list(prefix, { limit: 100, sortBy: { column: "created_at", order: "desc" } }),
    { context: { bucket: SURVEY_ASSETS_BUCKET, formId } },
  );
  if (error) throw new Error(`Не удалось загрузить пользовательские фоны: ${error.message}`);

  return (data ?? [])
    .filter((item) => item.id && item.name && !item.name.startsWith("."))
    .map((item) => mapListedAsset(prefix, item.name, "custom"));
}

export async function removeSurveyBackground(asset: SurveyBackgroundAsset) {
  if (asset.source !== "custom") {
    throw new Error("Общий фон нельзя удалить");
  }
  const { error } = await runRequest(
    "surveyAssets.remove",
    () => supabaseClient.storage.from(SURVEY_ASSETS_BUCKET).remove([asset.id]),
    { context: { bucket: SURVEY_ASSETS_BUCKET, path: asset.id } },
  );
  if (error) throw new Error(`Не удалось удалить фон: ${error.message}`);
}

function getSurveyAssetPath(url: string) {
  try {
    const parsedUrl = new URL(url, typeof window === "undefined" ? SUPABASE_URL : window.location.origin);
    if (parsedUrl.origin !== new URL(SUPABASE_URL).origin) return null;
    const marker = `/object/public/${SURVEY_ASSETS_BUCKET}/`;
    const markerIndex = parsedUrl.pathname.indexOf(marker);
    return markerIndex === -1 ? null : decodeURIComponent(parsedUrl.pathname.slice(markerIndex + marker.length));
  } catch {
    return null;
  }
}

function getAssetFormId(path: string) {
  const parts = path.split("/");
  return parts.length === 4 && parts[0] === "forms" ? parts[1] : null;
}

export function getSurveyThemeAssetPaths(themeValue: unknown) {
  const theme = sanitizeSurveyTheme(themeValue);
  return [...new Set([theme.backgroundImage, theme.header?.backgroundImage]
    .filter((url): url is string => Boolean(url))
    .map((url) => getSurveyAssetPath(url))
    .filter((path): path is string => Boolean(path && getAssetFormId(path))))];
}

export async function materializeSurveyThemeAssets(themeValue: unknown, targetFormId: string, ownerId: string) {
  const theme = sanitizeSurveyTheme(themeValue);
  const imageLocations: Array<{ get: () => string | undefined; set: (url: string) => void }> = [
    {
      get: () => theme.backgroundImage,
      set: (url) => { theme.backgroundImage = url; },
    },
    {
      get: () => theme.header?.backgroundImage,
      set: (url) => {
        theme.header = { ...(theme.header ?? {}), backgroundImage: url };
      },
    },
  ];

  const copiedBySource = new Map<string, string>();
  const uploadedPaths: string[] = [];

  try {
    for (const location of imageLocations) {
      const sourceUrl = location.get();
      if (!sourceUrl) continue;
      const sourcePath = getSurveyAssetPath(sourceUrl);
      if (!sourcePath || getAssetFormId(sourcePath) === targetFormId) continue;

      let copiedUrl = copiedBySource.get(sourcePath);
      if (!copiedUrl) {
        const response = await fetch(sourceUrl);
        if (!response.ok) throw new Error("Не удалось скопировать фоновое изображение темы");
        const blob = await response.blob();
        const file = new File([blob], "background", { type: blob.type });
        const uploaded = await uploadSurveyBackground(targetFormId, ownerId, file);
        uploadedPaths.push(uploaded.path);
        copiedUrl = uploaded.url;
        copiedBySource.set(sourcePath, copiedUrl);
      }
      location.set(copiedUrl);
    }
  } catch (error) {
    if (uploadedPaths.length > 0) {
      await supabaseClient.storage.from(SURVEY_ASSETS_BUCKET).remove(uploadedPaths);
    }
    throw error;
  }

  return { theme: theme as ITheme, uploadedPaths };
}

export async function removeSurveyAssetPaths(paths: string[]) {
  if (paths.length === 0) return;
  await supabaseClient.storage.from(SURVEY_ASSETS_BUCKET).remove(paths);
}
