import type { ITheme } from "survey-core";
import type { ICreatorTheme } from "survey-creator-core";

export type ThemeId = "sand" | "graphite";

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

const themeIds = ["sand", "graphite"] as const satisfies readonly ThemeId[];

const palettes: Record<ThemeId, AppThemeTokens> = {
  sand: {
    label: "Светлая",
    accent: "#0b57d0",
    accentHover: "#0842a0",
    bg: "#eeeae5",
    surface: "#e7ddd3",
    text: "#2f2925",
    muted: "#6d655f",
  },
  graphite: {
    label: "Тёмная",
    accent: "#a8c7fa",
    accentHover: "#c2d7fc",
    bg: "#131314",
    surface: "#1e1f20",
    text: "#e3e3e3",
    muted: "#c4c7c5",
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
    toolbar: "#fcfaf7",
    panel: "#fffdf9",
    panelMuted: "#ece7e2",
    workspace: "#f4f2ef",
    control: "#ffffff",
    border: "#d6d0ca",
    text: "#2f2925",
    textMuted: "#6d655f",
    accent: "#0b57d0",
    accentHover: "#0842a0",
  },
  graphite: {
    toolbar: "#1e1f20",
    panel: "#242628",
    panelMuted: "#282a2c",
    workspace: "#18191a",
    control: "#282a2c",
    border: "#3c4043",
    text: "#e3e3e3",
    textMuted: "#c4c7c5",
    accent: "#a8c7fa",
    accentHover: "#c2d7fc",
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

function createSurveyTheme(app: AppThemeTokens, isDark = false): ITheme {
  const shadowColor = isDark ? "#000000" : app.text;
  const shadowAlphas = isDark ? [0.18, 0.24, 0.3] : [0.06, 0.08, 0.1];
  const editorBackground = isDark ? "#18191a" : rgba(app.surface, 0.88);
  const darkTypography: Record<string, string> = isDark
    ? {
      "--sjs-general-dim-forecolor": app.text,
      "--sjs-general-dim-forecolor-light": app.muted,
      "--sjs-font-pagetitle-color": app.text,
      "--sjs-font-pagedescription-color": app.muted,
      "--sjs-font-questiontitle-color": app.text,
      "--sjs-font-questiondescription-color": app.muted,
      "--sjs-font-surveytitle-color": app.text,
      "--sjs-font-surveydescription-color": app.muted,
    }
    : {};

  return {
    themeName: "default",
    colorPalette: isDark ? "dark" : "light",
    cssVariables: {
      "--sjs-primary-backcolor": app.accent,
      "--sjs-primary-backcolor-dark": app.accentHover,
      "--sjs-primary-backcolor-light": rgba(app.accent, 0.1),
      "--sjs-primary-background-500": app.accent,
      "--sjs-primary-background-400": app.accentHover,
      "--sjs-primary-background-10": rgba(app.accent, 0.06),
      "--sjs-primary-forecolor": isDark ? "#062e6f" : "#ffffff",
      "--sjs-header-backcolor": app.surface,
      "--sjs-general-backcolor": app.bg,
      "--sjs-general-backcolor-dim": app.surface,
      "--sjs-general-backcolor-dim-light": editorBackground,
      "--sjs-general-backcolor-dark": rgba(app.text, 0.12),
      "--sjs-general-forecolor": app.text,
      "--sjs-general-forecolor-light": app.muted,
      "--sjs-layer-1-foreground-100": app.text,
      "--sjs-layer-1-foreground-50": app.muted,
      "--sjs-layer-1-background-500": isDark ? editorBackground : app.bg,
      "--sjs-layer-3-background-500": app.surface,
      "--sjs-editor-background": editorBackground,
      "--sjs-editorpanel-backcolor": editorBackground,
      "--sjs-shadow-small": `0 10px 22px ${rgba(shadowColor, shadowAlphas[0])}`,
      "--sjs-shadow-medium": `0 16px 32px ${rgba(shadowColor, shadowAlphas[1])}`,
      "--sjs-shadow-large": `0 24px 48px ${rgba(shadowColor, shadowAlphas[2])}`,
      ...darkTypography,
    },
  };
}

function createCreatorTheme(themeId: ThemeId, palette: CreatorThemeTokens): ICreatorTheme {
  return {
    themeName: `survey-app-creator-${themeId}`,
    iconSet: "v2",
    isLight: themeId !== "graphite",
    cssVariables: {
      "--ctr-font-family": "var(--app-font-family)",
      "--sjs2-typography-font-family-default": "var(--app-font-family)",
      "--sjs-primary-backcolor": palette.accent,
      "--sjs-primary-backcolor-dark": palette.accentHover,
      "--sjs-primary-backcolor-light": rgba(palette.accent, 0.1),
      "--sjs-primary-background-500": palette.accent,
      "--sjs-primary-background-400": palette.accentHover,
      "--sjs-primary-background-10": rgba(palette.accent, 0.08),
      "--sjs-primary-forecolor": themeId === "graphite" ? "#062e6f" : "#ffffff",
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
      "--ctr-toolbox-item-text-color": palette.textMuted,
      "--ctr-toolbox-item-text-color-hovered": palette.text,
      "--ctr-toolbox-item-icon-color": palette.textMuted,
      "--ctr-toolbox-item-icon-color-hovered": palette.text,
      "--ctr-menu-item-background-color": palette.toolbar,
      "--ctr-menu-item-background-color-hovered": palette.panelMuted,
      "--ctr-menu-toolbar-button-background-color-hovered": palette.panelMuted,
      "--ctr-menu-toolbar-button-background-color-pressed": palette.panelMuted,
      "--ctr-menu-toolbar-button-icon-color-selected": palette.accent,
      "--ctr-menu-toolbar-button-opacity-disabled": themeId === "graphite" ? "0.55" : "0.25",
    },
  };
}

export const creatorThemes: Record<ThemeId, ICreatorTheme> = {
  sand: createCreatorTheme("sand", creatorPalettes.sand),
  graphite: createCreatorTheme("graphite", creatorPalettes.graphite),
};

export const themes: Record<ThemeId, SurveyThemeBundle> = {
  sand: {
    app: palettes.sand,
    creator: creatorThemes.sand,
    survey: createSurveyTheme(palettes.sand),
  },
  graphite: {
    app: palettes.graphite,
    creator: creatorThemes.graphite,
    survey: createSurveyTheme(palettes.graphite, true),
  },
};

export const themeOptions = themeIds.map((themeId) => ({
  id: themeId,
  label: themes[themeId].app.label,
}));

export function isThemeId(value: unknown): value is ThemeId {
  return typeof value === "string" && themeIds.includes(value as ThemeId);
}
