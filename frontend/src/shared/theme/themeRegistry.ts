import type { ITheme } from "survey-core";

type CreatorUiTheme = {
  themeName?: string;
  iconsSet?: string;
  cssVariables?: Record<string, string>;
};

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
  creatorUi: CreatorUiTheme;
};

export const THEME_STORAGE_KEY = "survey-app:theme";
export const DEFAULT_THEME_ID: ThemeId = "sand";

const themeIds = ["sand", "sky", "teal"] as const satisfies readonly ThemeId[];

const palettes: Record<ThemeId, AppThemeTokens> = {
  sand: {
    label: "Графит",
    accent: "#2b2f36",
    accentHover: "#1f2329",
    bg: "#f6f7f9",
    surface: "#eceff3",
    text: "#1a1d21",
    muted: "#6b7280",
  },
  sky: {
    label: "Небо",
    accent: "#2563eb",
    accentHover: "#1d4ed8",
    bg: "#f4f7fb",
    surface: "#e9eff7",
    text: "#17253d",
    muted: "#66758b",
  },
  teal: {
    label: "Бирюза",
    accent: "#207a53",
    accentHover: "#185f40",
    bg: "#f4f8f5",
    surface: "#e9f0eb",
    text: "#163126",
    muted: "#66756c",
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
    themeName: "defaultV2",
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

function createCreatorTheme(themeId: ThemeId, app: AppThemeTokens): CreatorUiTheme {
  return {
    themeName: `survey-app-${themeId}`,
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

export const themes: Record<ThemeId, SurveyThemeBundle> = {
  sand: {
    app: palettes.sand,
    survey: createSurveyTheme(palettes.sand),
    creatorUi: createCreatorTheme("sand", palettes.sand),
  },
  sky: {
    app: palettes.sky,
    survey: createSurveyTheme(palettes.sky),
    creatorUi: createCreatorTheme("sky", palettes.sky),
  },
  teal: {
    app: palettes.teal,
    survey: createSurveyTheme(palettes.teal),
    creatorUi: createCreatorTheme("teal", palettes.teal),
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
