import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_SURVEY_LOGO_TOKEN,
  resolveDefaultSurveyLogo,
  serializeDefaultSurveyLogo,
} from "./defaultSurveyLogo";
import type { SurveySchema } from "../types";
import { SUPABASE_URL } from "../../../shared/config/env";
import { SURVEY_ASSET_TOKEN_PREFIX } from "../../../shared/api/surveyAssetUrls";

vi.mock("../../../img/card_logo.png", () => ({
  default: "mock-card-logo-url",
}));

describe("defaultSurveyLogo", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("resolves the shared default logo token to the app logo asset", () => {
    const schema = {
      logo: DEFAULT_SURVEY_LOGO_TOKEN,
      pages: [],
    } satisfies SurveySchema;

    const resolved = resolveDefaultSurveyLogo(schema);

    expect(resolved).toMatchObject({
      logo: "mock-card-logo-url",
    });
    expect(schema.logo).toBe(DEFAULT_SURVEY_LOGO_TOKEN);
  });

  it("serializes the app logo asset back to the shared default token", () => {
    const serialized = serializeDefaultSurveyLogo({
      logo: "mock-card-logo-url",
      pages: [],
    } satisfies SurveySchema);

    expect(serialized).toMatchObject({
      logo: DEFAULT_SURVEY_LOGO_TOKEN,
    });
  });

  it("serializes managed Supabase logos to a durable token and resolves them for SurveyJS", () => {
    const assetPath = "forms/11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222/33333333-3333-4333-8333-333333333333.png";
    const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/survey-assets/${assetPath}`;
    const serialized = serializeDefaultSurveyLogo({ logo: publicUrl, pages: [] });

    expect(serialized.logo).toBe(`${SURVEY_ASSET_TOKEN_PREFIX}${assetPath}`);
    expect(resolveDefaultSurveyLogo(serialized).logo).toBe(publicUrl);
  });

  it("removes malformed managed logo tokens", () => {
    const schema = {
      logo: `${SURVEY_ASSET_TOKEN_PREFIX}../../private.png`,
      pages: [],
    } satisfies SurveySchema;

    expect(resolveDefaultSurveyLogo(schema)).toEqual({ pages: [] });
    expect(serializeDefaultSurveyLogo(schema)).toEqual({ pages: [] });
  });

  it("removes remote custom logos before SurveyJS can load them", () => {
    const schema = {
      logo: "https://example.com/custom-logo.png",
      pages: [],
    } satisfies SurveySchema;

    expect(resolveDefaultSurveyLogo(schema)).toEqual({ pages: [] });
    expect(serializeDefaultSurveyLogo(schema)).toEqual({ pages: [] });
  });

  it("round-trips managed image choices through save, reload, and a second save without losing labels", () => {
    const prefix = "forms/11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222/";
    const paths = ["33333333-3333-4333-8333-333333333333.png", "44444444-4444-4444-8444-444444444444.png"].map(name => prefix + name);
    const choices = paths.map((path, index) => ({ value: `v${index}`, text: `Логотип ${index}`, imageLink: `${SUPABASE_URL}/storage/v1/object/public/survey-assets/${path}` }));
    const schema: SurveySchema = { pages: [{ elements: [{ type: "panel", name: "p", elements: [{ type: "imagepicker", name: "logos", choices }] }] }] };
    const saved = serializeDefaultSurveyLogo(schema);
    expect(saved.pages[0].elements[0].elements![0].choices).toEqual(choices.map((choice, index) => ({ ...choice, imageLink: `__APP_SURVEY_ASSET__/${paths[index]}` })));
    const restored = resolveDefaultSurveyLogo(saved);
    expect(restored).toEqual(schema);
    expect(serializeDefaultSurveyLogo(restored)).toEqual(saved);
    expect(schema.pages[0].elements[0].elements![0].choices).toEqual(choices);
  });
});
