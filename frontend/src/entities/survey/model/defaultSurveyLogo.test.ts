import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_SURVEY_LOGO_TOKEN,
  resolveDefaultSurveyLogo,
  serializeDefaultSurveyLogo,
} from "./defaultSurveyLogo";
import type { SurveySchema } from "../types";

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

  it("removes remote custom logos before SurveyJS can load them", () => {
    const schema = {
      logo: "https://example.com/custom-logo.png",
      pages: [],
    } satisfies SurveySchema;

    expect(resolveDefaultSurveyLogo(schema)).toEqual({ pages: [] });
    expect(serializeDefaultSurveyLogo(schema)).toEqual({ pages: [] });
  });
});
