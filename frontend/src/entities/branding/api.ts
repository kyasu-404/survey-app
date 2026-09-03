import { apiClient, supabaseClient } from "../../shared/api";
import { runRequest } from "../../shared/api/request";
import { SURVEY_ASSETS_BUCKET } from "../../shared/api/surveyAssetUrls";
import type { AppBranding } from "./types";

export const APP_BRANDING_QUERY_KEY = ["app-branding"] as const;
export const APP_LOGO_ACCEPT = "image/jpeg,image/png,image/webp";
export const MAX_APP_LOGO_SIZE_BYTES = 2 * 1024 * 1024;

const APP_LOGO_PATH_PATTERN = /^app-branding\/sidebar-logo-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(?:jpe?g|png|webp)$/i;
const APP_LOGO_EXTENSIONS: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
};

type BrandingRow = {
  sidebar_logo_path: string | null;
  updated_at: string | null;
};

type BrandingUpdateRow = BrandingRow & {
  previous_sidebar_logo_path: string | null;
};

function generateUuid() {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();

  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"));
  return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10).join("")}`;
}

function getPublicLogoUrl(path: string, updatedAt: string | null) {
  const publicUrl = supabaseClient.storage.from(SURVEY_ASSETS_BUCKET).getPublicUrl(path).data.publicUrl;
  return `${publicUrl}?v=${encodeURIComponent(updatedAt ?? path)}`;
}

function mapBranding(row: BrandingRow | null): AppBranding {
  const path = row?.sidebar_logo_path;
  const safePath = path && APP_LOGO_PATH_PATTERN.test(path) ? path : null;
  return {
    sidebarLogoPath: safePath,
    sidebarLogoUrl: safePath ? getPublicLogoUrl(safePath, row?.updated_at ?? null) : null,
    updatedAt: row?.updated_at ?? null,
  };
}

export function validateAppLogoFile(file: File) {
  if (!APP_LOGO_EXTENSIONS[file.type]) {
    throw new Error("Поддерживаются только JPG, PNG и WebP");
  }
  if (file.size <= 0 || file.size > MAX_APP_LOGO_SIZE_BYTES) {
    throw new Error("Размер логотипа должен быть не больше 2 МБ");
  }
}

export async function getAppBranding() {
  const { data, error } = await runRequest(
    "branding.get",
    (signal) => apiClient
      .from("app_branding")
      .select("sidebar_logo_path, updated_at")
      .eq("id", 1)
      .abortSignal(signal)
      .maybeSingle(),
  );
  if (error) throw error;
  return mapBranding(data as BrandingRow | null);
}

async function setSidebarLogoPath(path: string | null) {
  const { data, error } = await runRequest(
    "branding.setSidebarLogo",
    () => apiClient.rpc("set_sidebar_logo_path", { p_sidebar_logo_path: path }),
    { context: { hasCustomLogo: Boolean(path) } },
  );
  if (error) throw error;

  const row = (Array.isArray(data) ? data[0] : data) as BrandingUpdateRow | null;
  if (!row) throw new Error("Сервер не вернул сохранённые настройки логотипа");
  return row;
}

async function removeLogoBestEffort(path: string | null) {
  if (!path || !APP_LOGO_PATH_PATTERN.test(path)) return;
  try {
    const { error } = await runRequest(
      "branding.removeOldLogo",
      () => supabaseClient.storage.from(SURVEY_ASSETS_BUCKET).remove([path]),
      { context: { bucket: SURVEY_ASSETS_BUCKET, path } },
    );
    if (error) console.error("Не удалось удалить предыдущий логотип", error);
  } catch (error) {
    console.error("Не удалось удалить предыдущий логотип", error);
  }
}

export async function uploadAppLogo(file: File) {
  validateAppLogoFile(file);
  const path = `app-branding/sidebar-logo-${generateUuid()}${APP_LOGO_EXTENSIONS[file.type]}`;
  const bucket = supabaseClient.storage.from(SURVEY_ASSETS_BUCKET);
  const { error: uploadError } = await runRequest(
    "branding.uploadLogo",
    () => bucket.upload(path, file, {
      cacheControl: "31536000",
      contentType: file.type,
      upsert: false,
    }),
    { context: { bucket: SURVEY_ASSETS_BUCKET, fileSize: file.size, fileType: file.type } },
  );
  if (uploadError) throw new Error(`Не удалось загрузить логотип: ${uploadError.message}`);

  try {
    const row = await setSidebarLogoPath(path);
    await removeLogoBestEffort(row.previous_sidebar_logo_path);
    return mapBranding(row);
  } catch (error) {
    await removeLogoBestEffort(path);
    throw error;
  }
}

export async function resetAppLogo() {
  const row = await setSidebarLogoPath(null);
  await removeLogoBestEffort(row.previous_sidebar_logo_path);
  return mapBranding(row);
}
