import { SUPABASE_URL } from "../config/env";

export const SURVEY_ASSETS_BUCKET = "survey-assets";
export const SURVEY_ASSET_TOKEN_PREFIX = "__APP_SURVEY_ASSET__/";

const UUID_PATH_PART = "[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const SURVEY_ASSET_PATH = new RegExp(
  `^(?:gallery/[a-z0-9._-]{1,255}|forms/${UUID_PATH_PART}/${UUID_PATH_PART}/${UUID_PATH_PART}\\.(?:jpe?g|png|webp))$`,
  "i",
);

function isManagedSurveyAssetPath(path: string) {
  return SURVEY_ASSET_PATH.test(path);
}

function getPublicAssetPathPrefix() {
  const baseUrl = new URL(SUPABASE_URL);
  const basePath = baseUrl.pathname.replace(/\/$/, "");

  return `${basePath}/storage/v1/object/public/${SURVEY_ASSETS_BUCKET}/`;
}

export function getManagedSurveyAssetPath(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  if (normalized.startsWith(SURVEY_ASSET_TOKEN_PREFIX)) {
    const tokenPath = normalized.slice(SURVEY_ASSET_TOKEN_PREFIX.length);
    return isManagedSurveyAssetPath(tokenPath) ? tokenPath : null;
  }

  try {
    const assetUrl = new URL(normalized);
    const supabaseUrl = new URL(SUPABASE_URL);
    const publicAssetPathPrefix = getPublicAssetPathPrefix();

    if (
      assetUrl.origin !== supabaseUrl.origin
      || assetUrl.search !== ""
      || assetUrl.hash !== ""
      || !assetUrl.pathname.startsWith(publicAssetPathPrefix)
    ) {
      return null;
    }

    const assetPath = decodeURIComponent(assetUrl.pathname.slice(publicAssetPathPrefix.length));
    return isManagedSurveyAssetPath(assetPath) ? assetPath : null;
  } catch {
    return null;
  }
}

export function serializeManagedSurveyAssetUrl(value: string): string | null {
  const normalized = value.trim();
  const assetPath = getManagedSurveyAssetPath(normalized);

  if (assetPath) {
    return `${SURVEY_ASSET_TOKEN_PREFIX}${assetPath}`;
  }

  return normalized.startsWith(SURVEY_ASSET_TOKEN_PREFIX) ? null : value;
}

export function resolveManagedSurveyAssetUrl(value: string): string | null {
  const normalized = value.trim();
  if (!normalized.startsWith(SURVEY_ASSET_TOKEN_PREFIX)) {
    return value;
  }

  const assetPath = getManagedSurveyAssetPath(normalized);
  if (!assetPath) {
    return null;
  }

  return `${SUPABASE_URL.replace(/\/$/, "")}/storage/v1/object/public/${SURVEY_ASSETS_BUCKET}/${assetPath}`;
}
