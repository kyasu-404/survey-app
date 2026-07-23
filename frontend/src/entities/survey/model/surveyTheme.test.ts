import { describe, expect, it } from "vitest";
import {
  DEFAULT_SURVEY_THEME,
  resolveSurveyTheme,
  sanitizeSurveyTheme,
  withSurveyBackground,
} from "./surveyTheme";

describe("survey theme", () => {
  it("falls back to the application theme for missing legacy values", () => {
    expect(resolveSurveyTheme(null)).toEqual(DEFAULT_SURVEY_THEME);
  });

  it("keeps supported SurveyJS theme properties", () => {
    expect(sanitizeSurveyTheme({
      themeName: "sharp",
      colorPalette: "dark",
      isPanelless: true,
      backgroundImage: "https://cdn.example.com/background.webp",
      backgroundImageFit: "cover",
      backgroundImageAttachment: "fixed",
      backgroundOpacity: 0.4,
      headerView: "advanced",
      header: {
        height: 240,
        backgroundImage: "/theme-backgrounds/waves.svg",
        backgroundImageOpacity: 0.7,
      },
      cssVariables: {
        "--sjs-primary-backcolor": "#123456",
      },
    })).toMatchObject({
      themeName: "sharp",
      colorPalette: "dark",
      isPanelless: true,
      backgroundImage: "https://cdn.example.com/background.webp",
      backgroundOpacity: 0.4,
      header: {
        height: 240,
        backgroundImage: "/theme-backgrounds/waves.svg",
      },
      cssVariables: {
        "--sjs-primary-backcolor": "#123456",
      },
    });
  });

  it("drops active CSS and unsafe image URLs before persistence or rendering", () => {
    expect(sanitizeSurveyTheme({
      backgroundImage: "javascript:alert(1)",
      header: { backgroundImage: "//evil.example/background.png" },
      cssVariables: {
        "--safe-color": "#fff",
        "--unsafe-image": "url(https://evil.example/tracker)",
        color: "red",
      },
    })).toEqual({
      cssVariables: {
        "--safe-color": "#fff",
      },
    });
  });

  it("allows local Supabase development URLs without allowing arbitrary plain HTTP", () => {
    expect(sanitizeSurveyTheme({ backgroundImage: "http://localhost:8000/storage/background.webp" }))
      .toHaveProperty("backgroundImage");
    expect(sanitizeSurveyTheme({ backgroundImage: "http://evil.example/background.webp" }))
      .not.toHaveProperty("backgroundImage");
  });

  it("sets and clears the SurveyJS page background without discarding the theme", () => {
    const themed = withSurveyBackground({ themeName: "sharp", colorPalette: "dark" }, "/background.png");
    expect(themed).toMatchObject({
      themeName: "sharp",
      colorPalette: "dark",
      backgroundImage: "/background.png",
      backgroundOpacity: 0.35,
    });

    expect(withSurveyBackground(themed, "")).toMatchObject({
      themeName: "sharp",
      backgroundImage: "",
      backgroundOpacity: 1,
    });
  });
});
