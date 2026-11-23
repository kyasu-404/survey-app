import { describe, expect, it } from "vitest";
import {
  DEFAULT_SURVEY_THEME,
  resolveBuilderDesignerTheme,
  resolveSurveyTheme,
  sanitizeSurveyTheme,
  withSurveyBackground,
  withUploadedSurveyThemeImage,
} from "./surveyTheme";

describe("survey theme", () => {
  it("falls back to the application theme for missing legacy values", () => {
    expect(resolveSurveyTheme(null)).toEqual(DEFAULT_SURVEY_THEME);
  });

  it("maps the SurveyJS v1 default theme name to its v2 equivalent", () => {
    expect(sanitizeSurveyTheme({
      themeName: "defaultV2",
      colorPalette: "light",
    })).toEqual({
      themeName: "default",
      colorPalette: "light",
    });
  });

  it("keeps supported SurveyJS theme properties", () => {
    expect(sanitizeSurveyTheme({
      themeName: "sharp",
      colorPalette: "dark",
      isPanelless: true,
      backgroundImage: "__APP_SURVEY_ASSET__/forms/11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222/33333333-3333-4333-8333-333333333333.webp",
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
      backgroundImage: "__APP_SURVEY_ASSET__/forms/11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222/33333333-3333-4333-8333-333333333333.webp",
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

  it("blocks obfuscated CSS functions, escapes, comments, and @-rules via AST validation", () => {
    expect(sanitizeSurveyTheme({
      cssVariables: {
        "--safe-color": "rgb(18, 52, 86)",
        "--safe-font": "'Inter', sans-serif",
        "--comment-url": "u/**/rl(https://evil.example/a.png)",
        "--escaped-url": "\\75rl(https://evil.example/b.png)",
        "--image-set": "image-set(url(https://evil.example/c.png) 1x)",
        "--expr": "expression(alert(1))",
        "--import-rule": "@import 'https://evil.example/x.css'",
        "--semicolon": "#fff; background: url(https://evil.example/d.png)",
        "--braces": "#fff } body { color: red }",
      },
    })).toEqual({
      cssVariables: {
        "--safe-color": "rgb(18, 52, 86)",
        "--safe-font": "'Inter', sans-serif",
      },
    });
  });

  it("rejects HTTP images outside configured Storage and the current site", () => {
    expect(sanitizeSurveyTheme({ backgroundImage: "http://localhost:8000/storage/background.webp" }))
      .not.toHaveProperty("backgroundImage");
    expect(sanitizeSurveyTheme({ backgroundImage: "http://evil.example/background.webp" }))
      .not.toHaveProperty("backgroundImage");
  });

  it("rejects arbitrary HTTPS image URLs used for stored tracking", () => {
    expect(sanitizeSurveyTheme({ backgroundImage: "https://tracker.example/pixel.png" }))
      .not.toHaveProperty("backgroundImage");
  });

  it("sets and clears the SurveyJS page background without discarding the theme", () => {
    const themed = withSurveyBackground({ themeName: "sharp", colorPalette: "dark" }, "/background.png");
    expect(themed).toMatchObject({
      themeName: "sharp",
      colorPalette: "dark",
      backgroundImage: "/background.png",
      backgroundOpacity: 1,
    });

    expect(withSurveyBackground(themed, "")).toMatchObject({
      themeName: "sharp",
      backgroundImage: "",
      backgroundOpacity: 1,
    });
  });

  it("keeps the complete theme in Designer while subduing only its background image", () => {
    expect(resolveBuilderDesignerTheme({
      themeName: "sharp",
      colorPalette: "dark",
      isPanelless: true,
      backgroundImage: "/background.png",
      backgroundImageAttachment: "fixed",
      backgroundOpacity: 0.9,
      headerView: "advanced",
      header: { height: 280 },
      cssVariables: {
        "--sjs-font-family": "Georgia, serif",
        "--sjs-corner-radius": "20px",
      },
    })).toMatchObject({
      themeName: "sharp",
      colorPalette: "dark",
      isPanelless: true,
      backgroundImage: "/background.png",
      backgroundImageAttachment: "scroll",
      backgroundOpacity: 0.18,
      headerView: "advanced",
      header: { height: 280 },
      cssVariables: {
        "--sjs-font-family": "Georgia, serif",
        "--sjs-corner-radius": "20px",
      },
    });
  });

  it("places uploaded Theme Editor images into the requested theme background", () => {
    const theme = {
      themeName: "sharp",
      backgroundOpacity: 0.72,
      header: { height: 240 },
    };

    expect(withUploadedSurveyThemeImage(
      theme,
      "theme",
      "backgroundImage",
      "/api/storage/v1/object/public/survey-assets/uploaded-background.png",
    )).toMatchObject({
      themeName: "sharp",
      backgroundOpacity: 0.72,
      backgroundImage: "/api/storage/v1/object/public/survey-assets/uploaded-background.png",
      header: { height: 240 },
    });

    expect(withUploadedSurveyThemeImage(
      theme,
      "header",
      "backgroundImage",
      "/api/storage/v1/object/public/survey-assets/uploaded-header.png",
    )).toMatchObject({
      themeName: "sharp",
      header: {
        height: 240,
        backgroundImage: "/api/storage/v1/object/public/survey-assets/uploaded-header.png",
      },
    });
  });
});
