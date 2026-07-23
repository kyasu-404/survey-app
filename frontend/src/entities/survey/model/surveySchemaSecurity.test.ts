import { describe, expect, it } from "vitest";
import type { SurveySchema } from "../types";
import {
  MAX_SURVEY_SCHEMA_DEPTH,
  SurveySchemaSecurityError,
  isSafeSurveyNavigationUrl,
  sanitizeSurveyHtml,
  sanitizeSurveySchema,
} from "./surveySchemaSecurity";

describe("survey schema security", () => {
  it("removes active URL properties at every level", () => {
    const result = sanitizeSurveySchema({
      navigateToUrl: "https://attacker.test/{answer}",
      pages: [{ elements: [{ type: "dropdown", name: "q", choicesByUrl: { url: "https://attacker.test" } }] }],
    } as unknown as SurveySchema);

    expect(JSON.stringify(result)).not.toContain("attacker.test");
    expect(result.pages).toHaveLength(1);
  });

  it("removes cross-origin media URLs while retaining local and embedded raster assets", () => {
    const result = sanitizeSurveySchema({
      logo: "https://attacker.test/logo.png",
      backgroundImage: "//attacker.test/background.png",
      pages: [{
        elements: [
          { type: "image", name: "remote", imageLink: "https://attacker.test/tracker" },
          { type: "image", name: "local", imageLink: "/assets/local.png" },
          { type: "image", name: "embedded", imageLink: "data:image/png;base64,aGVsbG8=" },
          { type: "html", name: "video", contentMode: "youtube", videoLink: "https://attacker.test/video" },
        ],
      }],
    } as unknown as SurveySchema) as unknown as {
      logo?: string;
      backgroundImage?: string;
      pages: Array<{ elements: Array<Record<string, unknown>> }>;
    };

    expect(result.logo).toBeUndefined();
    expect(result.backgroundImage).toBeUndefined();
    expect(result.pages[0].elements[0].imageLink).toBeUndefined();
    expect(result.pages[0].elements[1].imageLink).toBe("/assets/local.png");
    expect(result.pages[0].elements[2].imageLink).toBe("data:image/png;base64,aGVsbG8=");
    expect(result.pages[0].elements[3].contentMode).toBeUndefined();
    expect(result.pages[0].elements[3].videoLink).toBeUndefined();
  });

  it("rejects excessive nesting", () => {
    const schema: Record<string, unknown> = {};
    let cursor = schema;
    for (let index = 0; index <= MAX_SURVEY_SCHEMA_DEPTH + 1; index += 1) {
      cursor.child = {};
      cursor = cursor.child as Record<string, unknown>;
    }

    expect(() => sanitizeSurveySchema(schema as SurveySchema)).toThrow(SurveySchemaSecurityError);
  });

  it("sanitizes executable and network-capable HTML", () => {
    const result = sanitizeSurveyHtml('<p onclick="alert(1)">OK</p><img src="https://attacker.test/x"><script>alert(1)</script>');
    expect(result).toBe("<p>OK</p>");
  });

  it("allows navigation only to the same HTTP origin", () => {
    expect(isSafeSurveyNavigationUrl("/done", "https://survey.test/form")).toBe(true);
    expect(isSafeSurveyNavigationUrl("https://attacker.test/done", "https://survey.test/form")).toBe(false);
    expect(isSafeSurveyNavigationUrl("javascript:alert(1)", "https://survey.test/form")).toBe(false);
  });
});
