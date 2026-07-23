import { describe, expect, it } from "vitest";
import { SUPABASE_URL } from "../config/env";
import {
  BUILT_IN_SURVEY_BACKGROUNDS,
  MAX_SURVEY_BACKGROUND_SIZE_BYTES,
  getSurveyThemeAssetPaths,
  validateSurveyBackgroundFile,
} from "./themeAssets";

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
});
