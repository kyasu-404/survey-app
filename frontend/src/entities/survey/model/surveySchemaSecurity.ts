import type { SurveySchema } from "../types";
import { serializeManagedSurveyAssetUrl } from "../../../shared/api/surveyAssetUrls";

export const MAX_SURVEY_SCHEMA_BYTES = 256 * 1024;
export const MAX_SURVEY_SCHEMA_DEPTH = 32;
export const MAX_SURVEY_SCHEMA_NODES = 10_000;

const BLOCKED_SCHEMA_KEYS = new Set([
  "__proto__",
  "prototype",
  "constructor",
  "navigateToUrl",
  "navigateToUrlOnCondition",
  "choicesByUrl",
]);

export const PASSIVE_ASSET_URL_KEYS = new Set([
  "backgroundImage",
  "image",
  "imageLink",
  "imageUrl",
  "logo",
  "poster",
  "source",
  "videoLink",
]);
const DEFAULT_SURVEY_LOGO_TOKEN = "__APP_DEFAULT_CARD_LOGO__";
const SAFE_EMBEDDED_RASTER_IMAGE = /^data:image\/(?:png|jpe?g|gif|webp);base64,[a-z0-9+/=]+$/i;


export class SurveySchemaSecurityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SurveySchemaSecurityError";
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function getUtf8ByteLength(value: string) {
  return new TextEncoder().encode(value).byteLength;
}

function isSafePassiveAssetUrl(value: unknown) {
  if (typeof value !== "string") {
    return false;
  }

  const normalized = value.trim();
  if (!normalized) {
    return true;
  }

  if (normalized === DEFAULT_SURVEY_LOGO_TOKEN || SAFE_EMBEDDED_RASTER_IMAGE.test(normalized)) {
    return true;
  }

  // Relative URLs are served by this application. Protocol-relative URLs,
  // backslash variants and explicit schemes would create cross-origin loads.
  return !normalized.startsWith("//")
    && !normalized.startsWith("\\")
    && !/^[a-z][a-z0-9+.-]*:/i.test(normalized);
}

/**
 * Copies an untrusted SurveyJS schema without recursion, strips browser-active
 * URL features and rejects structures that could exhaust the renderer.
 */
export function sanitizeSurveySchema(schema: SurveySchema): SurveySchema {
  if (!isObject(schema) || Array.isArray(schema)) {
    throw new SurveySchemaSecurityError("Схема формы должна быть JSON-объектом");
  }

  const root: Record<string, unknown> = {};
  const queue: Array<{
    source: Record<string, unknown> | unknown[];
    target: Record<string, unknown> | unknown[];
    depth: number;
  }> = [{ source: schema, target: root, depth: 0 }];
  let nodeCount = 1;

  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const { source, target, depth } = queue[cursor];
    if (depth > MAX_SURVEY_SCHEMA_DEPTH) {
      throw new SurveySchemaSecurityError("Схема формы имеет слишком большую глубину");
    }

    for (const [key, originalValue] of Object.entries(source)) {
      let value = originalValue;
      if (BLOCKED_SCHEMA_KEYS.has(key)) {
        continue;
      }

      if (PASSIVE_ASSET_URL_KEYS.has(key)) {
        // Upload callbacks return absolute Storage URLs. Save trusted images as tokens
        // before the general external-URL filter, including nested image picker choices.
        if (typeof value === "string") value = serializeManagedSurveyAssetUrl(value);
        if (!isSafePassiveAssetUrl(value)) continue;
      }

      if (key === "contentMode" && value !== "image") {
        continue;
      }

      if (!isObject(value)) {
        if (Array.isArray(target)) {
          target[Number(key)] = value;
        } else {
          target[key] = value;
        }
        continue;
      }

      nodeCount += 1;
      if (nodeCount > MAX_SURVEY_SCHEMA_NODES) {
        throw new SurveySchemaSecurityError("Схема формы содержит слишком много элементов");
      }

      const nestedTarget: Record<string, unknown> | unknown[] = Array.isArray(value) ? [] : {};
      if (Array.isArray(target)) {
        target[Number(key)] = nestedTarget;
      } else {
        target[key] = nestedTarget;
      }
      queue.push({ source: value, target: nestedTarget, depth: depth + 1 });
    }
  }

  const serialized = JSON.stringify(root);
  if (getUtf8ByteLength(serialized) > MAX_SURVEY_SCHEMA_BYTES) {
    throw new SurveySchemaSecurityError("Схема формы превышает допустимый размер 256 КБ");
  }

  return root as SurveySchema;
}


export function isSafeSurveyNavigationUrl(url: string, baseUrl = window.location.href) {
  try {
    const parsed = new URL(url, baseUrl);
    const base = new URL(baseUrl);
    return (
      (parsed.protocol === "http:" || parsed.protocol === "https:")
      && parsed.origin === base.origin
      && parsed.username === ""
      && parsed.password === ""
    );
  } catch {
    return false;
  }
}
