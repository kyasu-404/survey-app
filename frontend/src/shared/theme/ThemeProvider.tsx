import { createContext, useContext, useEffect, useState, type PropsWithChildren } from "react";
import {
  DEFAULT_THEME_ID,
  THEME_STORAGE_KEY,
  getNextThemeId,
  isThemeId,
  themeOptions,
  themes,
  type SurveyThemeBundle,
  type ThemeId,
} from "./themeRegistry";

type ThemeContextValue = {
  themeId: ThemeId;
  theme: SurveyThemeBundle;
  themeOptions: typeof themeOptions;
  setTheme: (themeId: ThemeId) => void;
  cycleTheme: () => void;
};

const defaultContextValue: ThemeContextValue = {
  themeId: DEFAULT_THEME_ID,
  theme: themes[DEFAULT_THEME_ID],
  themeOptions,
  setTheme: () => undefined,
  cycleTheme: () => undefined,
};

const ThemeContext = createContext<ThemeContextValue>(defaultContextValue);

function readInitialThemeId(): ThemeId {
  if (typeof window === "undefined") {
    return DEFAULT_THEME_ID;
  }

  const storedThemeId = window.localStorage.getItem(THEME_STORAGE_KEY);
  return isThemeId(storedThemeId) ? storedThemeId : DEFAULT_THEME_ID;
}

type ThemeProviderProps = PropsWithChildren<{
  isThemeApplied?: boolean;
}>;

export function ThemeProvider({ children, isThemeApplied = true }: ThemeProviderProps) {
  const [themeId, setThemeId] = useState<ThemeId>(() => readInitialThemeId());
  const theme = themes[themeId];

  useEffect(() => {
    if (!isThemeApplied) {
      document.documentElement.removeAttribute("data-theme");
      return;
    }

    document.documentElement.dataset.theme = themeId;
    window.localStorage.setItem(THEME_STORAGE_KEY, themeId);
  }, [isThemeApplied, themeId]);

  return (
    <ThemeContext.Provider
      value={{
        themeId,
        theme,
        themeOptions,
        setTheme: setThemeId,
        cycleTheme: () => setThemeId((currentThemeId) => getNextThemeId(currentThemeId)),
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
