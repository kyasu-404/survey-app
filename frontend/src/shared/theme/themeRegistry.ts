import type { ITheme } from "survey-core";
import type { ICreatorTheme } from "survey-creator-core";

export type ThemeId = "sand" | "sky" | "teal";

export type AppThemeTokens = {
  label: string;
  accent: string;
  accentHover: string;
  bg: string;
  surface: string;
  text: string;
  muted: string;
};

export type SurveyThemeBundle = {
  app: AppThemeTokens;
  survey: ITheme;
};

export const THEME_STORAGE_KEY = "survey-app:theme";
export const DEFAULT_THEME_ID: ThemeId = "sand";

const themeIds = ["sand", "sky", "teal"] as const satisfies readonly ThemeId[];

const palettes: Record<ThemeId, AppThemeTokens> = {
  sand: {
    label: "Бежевая",
    accent: "#6f5137",
    accentHover: "#563d2a",
    bg: "#f7f1e8",
    surface: "#eadfce",
    text: "#2d241d",
    muted: "#75685d",
  },
  sky: {
    label: "Голубая",
    accent: "#397fbd",
    accentHover: "#2c6599",
    bg: "#eef6fc",
    surface: "#d9eaf7",
    text: "#183047",
    muted: "#607487",
  },
  teal: {
    label: "Зелёная",
    accent: "#3c805b",
    accentHover: "#2f6748",
    bg: "#eef7f0",
    surface: "#d9ebdd",
    text: "#20372a",
    muted: "#64766b",
  },
};

function hexToRgb(hex: string) {
  const normalized = hex.replace("#", "");
  const expanded = normalized.length === 3
    ? normalized
      .split("")
      .map((char) => `${char}${char}`)
      .join("")
    : normalized;

  const red = Number.parseInt(expanded.slice(0, 2), 16);
  const green = Number.parseInt(expanded.slice(2, 4), 16);
  const blue = Number.parseInt(expanded.slice(4, 6), 16);

  return `${red}, ${green}, ${blue}`;
}

function rgba(hex: string, alpha: number) {
  return `rgba(${hexToRgb(hex)}, ${alpha})`;
}

function createSurveyTheme(app: AppThemeTokens): ITheme {
  return {
    themeName: "default",
    colorPalette: "light",
    cssVariables: {
      "--sjs-primary-backcolor": app.accent,
      "--sjs-primary-backcolor-dark": app.accentHover,
      "--sjs-primary-backcolor-light": rgba(app.accent, 0.1),
      "--sjs-primary-background-500": app.accent,
      "--sjs-primary-background-400": app.accentHover,
      "--sjs-primary-background-10": rgba(app.accent, 0.06),
      "--sjs-primary-forecolor": "#ffffff",
      "--sjs-header-backcolor": app.surface,
      "--sjs-general-backcolor": app.bg,
      "--sjs-general-backcolor-dim": app.surface,
      "--sjs-general-backcolor-dim-light": rgba(app.surface, 0.88),
      "--sjs-general-backcolor-dark": rgba(app.text, 0.12),
      "--sjs-general-forecolor": app.text,
      "--sjs-general-forecolor-light": app.muted,
      "--sjs-layer-1-foreground-100": app.text,
      "--sjs-layer-1-foreground-50": app.muted,
      "--sjs-layer-1-background-500": app.bg,
      "--sjs-layer-3-background-500": app.surface,
      "--sjs-shadow-small": `0 10px 22px ${rgba(app.text, 0.06)}`,
      "--sjs-shadow-medium": `0 16px 32px ${rgba(app.text, 0.08)}`,
      "--sjs-shadow-large": `0 24px 48px ${rgba(app.text, 0.1)}`,
    },
  };
}

function createCreatorTheme(app: AppThemeTokens): ICreatorTheme {
  return {
    themeName: "survey-app-neutral",
    iconSet: "v2",
    isLight: true,
    cssVariables: {
      "--sjs-primary-backcolor": app.accent,
      "--sjs-primary-backcolor-dark": app.accentHover,
      "--sjs-primary-backcolor-light": rgba(app.accent, 0.1),
      "--sjs-primary-background-500": app.accent,
      "--sjs-primary-background-400": app.accentHover,
      "--sjs-primary-background-10": rgba(app.accent, 0.06),
      "--sjs-primary-forecolor": "#ffffff",
      "--sjs-general-backcolor": app.bg,
      "--sjs-general-backcolor-dim": app.surface,
      "--sjs-general-backcolor-dim-light": rgba(app.surface, 0.88),
      "--sjs-general-backcolor-dark": rgba(app.text, 0.12),
      "--sjs-general-forecolor": app.text,
      "--sjs-general-forecolor-light": app.muted,
      "--sjs-layer-1-foreground-100": app.text,
      "--sjs-layer-1-foreground-50": app.muted,
      "--sjs-layer-1-background-500": app.bg,
      "--sjs-layer-3-background-500": app.surface,
      "--sjs-special-background": app.surface,
      "--sjs2-color-utility-surface-designer": app.surface,
      "--ctr-button-group-item-text-color-selected": app.accent,
      "--ctr-button-group-item-icon-color-selected": app.accent,
      "--ctr-button-group-border-color-focused": app.accent,
      "--ctr-survey-action-button-text-color-positive": app.accent,
      "--ctr-menu-item-border-color-selected": app.accent,
      "--ctr-property-grid-header-border-color": app.accent,
      "--ctr-editor-border-color-focused": app.accent,
      "--ctr-editor-border-color-highlighted": rgba(app.accent, 0.18),
    },
  };
}

/**
 * Survey Creator has its own interface theme, separate from the theme of the
 * survey being edited. Keep this palette stable so application color schemes
 * cannot reduce the readability of the toolbox and property grid.
 */
export const NEUTRAL_CREATOR_THEME: ICreatorTheme = createCreatorTheme({
  label: "Нейтральная",
  accent: "#121212",
  accentHover: "#000000",
  bg: "#fffdf9",
  surface: "#f2eee8",
  text: "#181818",
  muted: "#5f5a54",
});

export const themes: Record<ThemeId, SurveyThemeBundle> = {
  sand: {
    app: palettes.sand,
    survey: createSurveyTheme(palettes.sand),
  },
  sky: {
    app: palettes.sky,
    survey: createSurveyTheme(palettes.sky),
  },
  teal: {
    app: palettes.teal,
    survey: createSurveyTheme(palettes.teal),
  },
};

export const themeOptions = themeIds.map((themeId) => ({
  id: themeId,
  label: themes[themeId].app.label,
}));

export function isThemeId(value: unknown): value is ThemeId {
  return typeof value === "string" && themeIds.includes(value as ThemeId);
}

export function getNextThemeId(themeId: ThemeId): ThemeId {
  const currentIndex = themeIds.indexOf(themeId);
  return themeIds[(currentIndex + 1) % themeIds.length];
}
