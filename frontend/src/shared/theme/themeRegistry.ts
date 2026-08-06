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
  creator: ICreatorTheme;
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
    bg: "#f4f8fb",
    surface: "#d5e4ef",
    text: "#183047",
    muted: "#607487",
  },
  teal: {
    label: "Зелёная",
    accent: "#3c805b",
    accentHover: "#2f6748",
    bg: "#f4f8f5",
    surface: "#d8e7dc",
    text: "#20372a",
    muted: "#64766b",
  },
};

type CreatorThemeTokens = {
  toolbar: string;
  panel: string;
  panelMuted: string;
  workspace: string;
  control: string;
  border: string;
  text: string;
  textMuted: string;
  accent: string;
  accentHover: string;
};

const creatorPalettes: Record<ThemeId, CreatorThemeTokens> = {
  sand: {
    toolbar: "#fffdf9",
    panel: "#faf6f0",
    panelMuted: "#f5efe7",
    workspace: "#eee7dd",
    control: "#fffdfa",
    border: "#ddd2c5",
    text: "#332b24",
    textMuted: "#786e65",
    accent: "#765137",
    accentHover: "#563d2a",
  },
  sky: {
    toolbar: "#fcfeff",
    panel: "#f4f8fb",
    panelMuted: "#edf4f8",
    workspace: "#e8f0f5",
    control: "#ffffff",
    border: "#d3e0e9",
    text: "#203447",
    textMuted: "#637787",
    accent: "#347db8",
    accentHover: "#2c6599",
  },
  teal: {
    toolbar: "#fcfefd",
    panel: "#f4f8f5",
    panelMuted: "#edf4ef",
    workspace: "#e8f0eb",
    control: "#ffffff",
    border: "#d2ded6",
    text: "#26392d",
    textMuted: "#68796e",
    accent: "#337f5b",
    accentHover: "#2f6748",
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

function createCreatorTheme(themeId: ThemeId, palette: CreatorThemeTokens): ICreatorTheme {
  return {
    themeName: `survey-app-creator-${themeId}`,
    iconSet: "v2",
    isLight: true,
    cssVariables: {
      "--sjs-primary-backcolor": palette.accent,
      "--sjs-primary-backcolor-dark": palette.accentHover,
      "--sjs-primary-backcolor-light": rgba(palette.accent, 0.1),
      "--sjs-primary-background-500": palette.accent,
      "--sjs-primary-background-400": palette.accentHover,
      "--sjs-primary-background-10": rgba(palette.accent, 0.08),
      "--sjs-primary-forecolor": "#ffffff",
      "--sjs-general-backcolor": palette.control,
      "--sjs-general-backcolor-dim": palette.panel,
      "--sjs-general-backcolor-dim-light": palette.toolbar,
      "--sjs-general-backcolor-dark": palette.border,
      "--sjs-general-forecolor": palette.text,
      "--sjs-general-forecolor-light": palette.textMuted,
      "--sjs-layer-1-foreground-100": palette.text,
      "--sjs-layer-1-foreground-50": palette.textMuted,
      "--sjs-layer-1-background-500": palette.control,
      "--sjs-layer-3-background-500": palette.control,
      "--sjs-special-background": palette.panelMuted,
      "--sjs2-color-utility-surface-designer": palette.workspace,
      "--ctr-surface-background-color": palette.workspace,
      "--ctr-property-grid-form-background-color": palette.panel,
      "--ctr-editor-background-color": palette.control,
      "--ctr-button-group-item-text-color-selected": palette.accent,
      "--ctr-button-group-item-icon-color-selected": palette.accent,
      "--ctr-button-group-border-color-focused": palette.accent,
      "--ctr-survey-action-button-text-color-positive": palette.accent,
      "--ctr-menu-item-border-color-selected": palette.accent,
      "--ctr-property-grid-header-border-color": palette.accent,
      "--ctr-editor-border-color-focused": palette.accent,
      "--ctr-editor-border-color-highlighted": rgba(palette.accent, 0.18),
      "--ctr-survey-question-panel-border-color-selected": palette.accent,
      "--ctr-survey-question-panel-border-color-hovered": rgba(palette.accent, 0.26),
    },
  };
}

export const creatorThemes: Record<ThemeId, ICreatorTheme> = {
  sand: createCreatorTheme("sand", creatorPalettes.sand),
  sky: createCreatorTheme("sky", creatorPalettes.sky),
  teal: createCreatorTheme("teal", creatorPalettes.teal),
};

export const themes: Record<ThemeId, SurveyThemeBundle> = {
  sand: {
    app: palettes.sand,
    creator: creatorThemes.sand,
    survey: createSurveyTheme(palettes.sand),
  },
  sky: {
    app: palettes.sky,
    creator: creatorThemes.sky,
    survey: createSurveyTheme(palettes.sky),
  },
  teal: {
    app: palettes.teal,
    creator: creatorThemes.teal,
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
