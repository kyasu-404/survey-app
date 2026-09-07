import { describe, expect, it, vi } from "vitest";
import { resolveBuilderDesignerTheme, withSurveyBackground, withUploadedSurveyThemeImage } from "../../entities/survey/model/surveyTheme";
import { SUPABASE_URL } from "../config/env";
import {
  BUILT_IN_SURVEY_BACKGROUNDS,
  MAX_SURVEY_BACKGROUND_SIZE_BYTES,
  getSurveyThemeAssetPaths,
  resolveSurveyThemeAssetUrls,
  serializeSurveyThemeAssetUrls,
  validateSurveyBackgroundFile,
} from "./themeAssets";

// Production serves Storage on a different HTTPS origin from the frontend.
vi.mock("../config/env", async (importOriginal) => ({
  ...await importOriginal<typeof import("../config/env")>(),
  SUPABASE_URL: "https://api.forms.imc-mosk.ru",
}));

describe("survey theme assets", () => {
  it("ships a separate built-in common background gallery", () => {
    expect(BUILT_IN_SURVEY_BACKGROUNDS).toHaveLength(4);
    expect(BUILT_IN_SURVEY_BACKGROUNDS.every((asset) => asset.source === "common")).toBe(true);
  });

  it("accepts supported images up to five megabytes", () => {
    const image = new File([new Uint8Array(64)], "background.webp", { type: "image/webp" });

    expect(() => validateSurveyBackgroundFile(image)).not.toThrow();
  });

  it("rejects unsupported and oversized uploads", () => {
    expect(() => validateSurveyBackgroundFile(
      new File(["<svg/>"], "background.svg", { type: "image/svg+xml" }),
    )).toThrow("JPG, PNG и WebP");

    expect(() => validateSurveyBackgroundFile(
      new File([new Uint8Array(MAX_SURVEY_BACKGROUND_SIZE_BYTES + 1)], "background.png", { type: "image/png" }),
    )).toThrow("не больше 5 МБ");
  });

  it("extracts only managed Supabase assets referenced by a theme", () => {
    const managedUrl = `${SUPABASE_URL}/storage/v1/object/public/survey-assets/forms/11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222/33333333-3333-4333-8333-333333333333.webp`;

    expect(getSurveyThemeAssetPaths({
      backgroundImage: managedUrl,
      header: { backgroundImage: "/theme-backgrounds/waves.svg" },
    })).toEqual(["forms/11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222/33333333-3333-4333-8333-333333333333.webp"]);
  });

  it("stores managed backgrounds as non-network tokens and restores them for rendering", () => {
    const managedUrl = `${SUPABASE_URL}/storage/v1/object/public/survey-assets/forms/11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222/33333333-3333-4333-8333-333333333333.webp`;
    const stored = serializeSurveyThemeAssetUrls({ backgroundImage: managedUrl });

    expect(stored.backgroundImage).toBe(
      "__APP_SURVEY_ASSET__/forms/11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222/33333333-3333-4333-8333-333333333333.webp",
    );
    expect(resolveSurveyThemeAssetUrls(stored).backgroundImage).toBe(managedUrl);
    expect(serializeSurveyThemeAssetUrls({ backgroundImage: "https://tracker.example/pixel.png" }))
      .not.toHaveProperty("backgroundImage");
  });

  it.each([
    "gallery/background.webp",
    "forms/11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222/33333333-3333-4333-8333-333333333333.webp",
  ])("keeps the selected Storage background through saving and reopening: %s", (path) => {
    const url = `${SUPABASE_URL}/storage/v1/object/public/survey-assets/${path}`;
    const selected = withSurveyBackground({ themeName: "sharp" }, url);
    expect(selected.backgroundImage).toBe(url);
    expect(resolveBuilderDesignerTheme(selected).backgroundImage).toBe(url);

    const stored = serializeSurveyThemeAssetUrls(selected);
    expect(stored.backgroundImage).toBe(`__APP_SURVEY_ASSET__/${path}`);
    expect(resolveSurveyThemeAssetUrls(JSON.parse(JSON.stringify(stored)))).toMatchObject({
      themeName: "sharp", backgroundImage: url,
    });

    const headerTheme = withUploadedSurveyThemeImage(selected, "header", "backgroundImage", url);
    expect(headerTheme.header?.backgroundImage).toBe(url);
    const storedHeader = serializeSurveyThemeAssetUrls(headerTheme);
    expect(storedHeader.header?.backgroundImage).toBe(`__APP_SURVEY_ASSET__/${path}`);
    expect(resolveSurveyThemeAssetUrls(storedHeader).header?.backgroundImage).toBe(url);
  });

  it.each([
    "https://tracker.example/storage/v1/object/public/survey-assets/gallery/background.webp",
    `${SUPABASE_URL}.tracker.example/storage/v1/object/public/survey-assets/gallery/background.webp`,
    `${SUPABASE_URL}/storage/v1/object/public/other-bucket/gallery/background.webp`,
    `${SUPABASE_URL}/storage/v1/object/public/survey-assets/other/background.webp`,
    `${SUPABASE_URL}/storage/v1/object/public/survey-assets/gallery/background.webp?tracking=1`,
    `${SUPABASE_URL}/storage/v1/object/public/survey-assets/gallery/background.webp#fragment`,
    `${SUPABASE_URL}/redirect?url=https://tracker.example/pixel.png`,
  ])("rejects URLs outside managed Storage assets: %s", (url) => {
    const selected = withSurveyBackground({}, url);
    expect(selected).not.toHaveProperty("backgroundImage");
    expect(withUploadedSurveyThemeImage({}, "header", "backgroundImage", url).header ?? {})
      .not.toHaveProperty("backgroundImage");
  });
});
