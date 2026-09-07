import type { IHeader, ITheme } from "survey-core";
import { getManagedSurveyAssetPath } from "../../../shared/api/surveyAssetUrls";

export const DEFAULT_SURVEY_THEME: ITheme = {
  themeName: "default",
  colorPalette: "light",
  backgroundImageFit: "cover",
  backgroundImageAttachment: "scroll",
  backgroundOpacity: 1,
  cssVariables: {
    "--sjs-primary-backcolor": "#121212",
    "--sjs-primary-backcolor-dark": "#000000",
    "--sjs-primary-backcolor-light": "rgba(18, 18, 18, 0.12)",
    "--sjs-primary-background-500": "#121212",
    "--sjs-primary-background-400": "#232323",
    "--sjs-primary-background-10": "rgba(18, 18, 18, 0.08)",
    "--sjs-primary-forecolor": "#ffffff",
    "--sjs-header-backcolor": "#121212",
    "--sjs-general-backcolor": "#fffdf9",
    "--sjs-general-backcolor-dim": "#f2eee8",
    "--sjs-general-backcolor-dim-light": "#f8f5f0",
    "--sjs-general-backcolor-dark": "#dfd9d1",
    "--sjs-general-forecolor": "#181818",
    "--sjs-general-forecolor-light": "#5f5a54",
    "--sjs-layer-1-foreground-100": "#181818",
    "--sjs-layer-1-foreground-50": "#5f5a54",
    "--sjs-layer-1-background-500": "#fffdf9",
    "--sjs-layer-3-background-500": "#f2eee8",
  },
};

const SAFE_CSS_VALUE = /^(?!.*(?:url\s*\(|expression\s*\(|@import|javascript:))[\u0020-\u007e\u00a0-\uffff]{1,512}$/i;
const MANAGED_ASSET_TOKEN = /^__APP_SURVEY_ASSET__\/(?:gallery\/[a-z0-9._-]{1,255}|forms\/[0-9a-f-]{36}\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.(?:jpe?g|png|webp))$/i;
const HEADER_STRING_PROPERTIES = {
  inheritWidthFrom: ["survey", "container"],
  backgroundImageFit: ["cover", "fill", "contain", "tile"],
  logoPositionX: ["left", "right", "center"],
  logoPositionY: ["top", "bottom", "middle"],
  titlePositionX: ["left", "right", "center"],
  titlePositionY: ["top", "bottom", "middle"],
  descriptionPositionX: ["left", "right", "center"],
  descriptionPositionY: ["top", "bottom", "middle"],
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isSafeImageUrl(value: string) {
  const normalized = value.trim();
  if (normalized === "") return true;
  if (MANAGED_ASSET_TOKEN.test(normalized)) return true;
  if (normalized.startsWith("/") && !normalized.startsWith("//") && !normalized.includes("\\")) return true;
  if (/\s|\\/.test(normalized)) return false;

  try {
    const url = new URL(normalized);
    if (url.protocol === "https:") {
      return getManagedSurveyAssetPath(normalized) !== null
        || (typeof window !== "undefined" && url.origin === window.location.origin);
    }
    if (url.protocol !== "http:") return false;

    return (
      url.hostname === "localhost"
      || url.hostname === "127.0.0.1"
      || url.hostname === "[::1]"
      || /^10\./.test(url.hostname)
      || /^192\.168\./.test(url.hostname)
      || /^172\.(1[6-9]|2\d|3[0-1])\./.test(url.hostname)
    );
  } catch {
    return false;
  }
}

function readString(value: unknown, maxLength = 256) {
  return typeof value === "string" && value.length <= maxLength ? value : undefined;
}

function readNumber(value: unknown, min: number, max: number) {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max
    ? value
    : undefined;
}

function sanitizeHeader(value: unknown): IHeader | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const header: IHeader = {};
  const height = readNumber(value.height, 0, 4096);
  const mobileHeight = readNumber(value.mobileHeight, 0, 4096);
  const textAreaWidth = readNumber(value.textAreaWidth, 0, 4096);
  const imageOpacity = readNumber(value.backgroundImageOpacity, 0, 1);
  const backgroundImage = readString(value.backgroundImage, 2048);

  if (height !== undefined) header.height = height;
  if (mobileHeight !== undefined) header.mobileHeight = mobileHeight;
  if (textAreaWidth !== undefined) header.textAreaWidth = textAreaWidth;
  if (typeof value.overlapEnabled === "boolean") header.overlapEnabled = value.overlapEnabled;
  if (imageOpacity !== undefined) header.backgroundImageOpacity = imageOpacity;
  if (backgroundImage !== undefined && isSafeImageUrl(backgroundImage)) header.backgroundImage = backgroundImage.trim();

  for (const [propertyName, acceptedValues] of Object.entries(HEADER_STRING_PROPERTIES)) {
    const propertyValue = value[propertyName];
    if (typeof propertyValue === "string" && (acceptedValues as readonly string[]).includes(propertyValue)) {
      (header as Record<string, unknown>)[propertyName] = propertyValue;
    }
  }

  return Object.keys(header).length > 0 ? header : undefined;
}

export function sanitizeSurveyTheme(value: unknown): ITheme {
  if (!isRecord(value)) {
    return {};
  }

  const theme: ITheme = {};
  const themeName = readString(value.themeName);
  const colorPalette = value.colorPalette === "light" || value.colorPalette === "dark" ? value.colorPalette : undefined;
  const backgroundImage = readString(value.backgroundImage, 2048);
  const backgroundOpacity = readNumber(value.backgroundOpacity, 0, 1);

  if (themeName) theme.themeName = themeName === "defaultV2" ? "default" : themeName;
  if (colorPalette) theme.colorPalette = colorPalette;
  if (typeof value.isPanelless === "boolean") theme.isPanelless = value.isPanelless;
  if (backgroundImage !== undefined && isSafeImageUrl(backgroundImage)) theme.backgroundImage = backgroundImage.trim();
  if (value.backgroundImageFit === "auto" || value.backgroundImageFit === "contain" || value.backgroundImageFit === "cover") {
    theme.backgroundImageFit = value.backgroundImageFit;
  }
  if (value.backgroundImageAttachment === "fixed" || value.backgroundImageAttachment === "scroll") {
    theme.backgroundImageAttachment = value.backgroundImageAttachment;
  }
  if (backgroundOpacity !== undefined) theme.backgroundOpacity = backgroundOpacity;
  if (value.headerView === "advanced" || value.headerView === "basic") theme.headerView = value.headerView;

  const header = sanitizeHeader(value.header);
  if (header) theme.header = header;

  if (isRecord(value.cssVariables)) {
    const cssVariables = Object.fromEntries(
      Object.entries(value.cssVariables)
        .filter(([key, cssValue]) => (
          /^--[a-z0-9_-]{1,120}$/i.test(key)
          && typeof cssValue === "string"
          && SAFE_CSS_VALUE.test(cssValue)
        ))
        .slice(0, 512),
    ) as Record<string, string>;

    if (Object.keys(cssVariables).length > 0) {
      theme.cssVariables = cssVariables;
    }
  }

  return theme;
}

export function resolveSurveyTheme(value: unknown): ITheme {
  const theme = sanitizeSurveyTheme(value);
  return Object.keys(theme).length > 0 ? theme : sanitizeSurveyTheme(DEFAULT_SURVEY_THEME);
}

const BUILDER_BACKGROUND_OPACITY_LIMIT = 0.18;

/**
 * The Designer must reflect the respondent theme without letting a large
 * background image compete with drag-and-drop affordances. Theme Editor and
 * runtime preview continue to use the unmodified theme.
 */
export function resolveBuilderDesignerTheme(value: unknown): ITheme {
  const theme = resolveSurveyTheme(value);

  if (!theme.backgroundImage) {
    return theme;
  }

  return sanitizeSurveyTheme({
    ...theme,
    backgroundImageAttachment: "scroll",
    backgroundOpacity: Math.min(theme.backgroundOpacity ?? 1, BUILDER_BACKGROUND_OPACITY_LIMIT),
  });
}

export function withSurveyBackground(theme: unknown, backgroundImage: string): ITheme {
  return sanitizeSurveyTheme({
    ...resolveSurveyTheme(theme),
    backgroundImage,
    backgroundImageFit: "cover",
    backgroundImageAttachment: "scroll",
    backgroundOpacity: 1,
  });
}

export function withUploadedSurveyThemeImage(
  theme: unknown,
  elementType: string | undefined,
  propertyName: string | undefined,
  imageUrl: string,
): ITheme {
  const resolvedTheme = resolveSurveyTheme(theme);

  if (propertyName !== "backgroundImage") {
    return resolvedTheme;
  }

  if (elementType === "header") {
    return sanitizeSurveyTheme({
      ...resolvedTheme,
      header: {
        ...(resolvedTheme.header ?? {}),
        backgroundImage: imageUrl,
      },
    });
  }

  if (elementType === "theme") {
    return sanitizeSurveyTheme({
      ...resolvedTheme,
      backgroundImage: imageUrl,
    });
  }

  return resolvedTheme;
}
