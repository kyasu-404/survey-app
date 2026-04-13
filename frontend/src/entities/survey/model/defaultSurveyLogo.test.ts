import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_SURVEY_LOGO_TOKEN,
  resolveDefaultSurveyLogo,
  serializeDefaultSurveyLogo,
} from "./defaultSurveyLogo";

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
    };

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
    });

    expect(serialized).toMatchObject({
      logo: DEFAULT_SURVEY_LOGO_TOKEN,
    });
  });

  it("keeps custom logos untouched", () => {
    const schema = {
      logo: "https://example.com/custom-logo.png",
      pages: [],
    };

    expect(resolveDefaultSurveyLogo(schema)).toMatchObject({
      logo: "https://example.com/custom-logo.png",
    });
    expect(serializeDefaultSurveyLogo(schema)).toMatchObject({
      logo: "https://example.com/custom-logo.png",
    });
  });
});
