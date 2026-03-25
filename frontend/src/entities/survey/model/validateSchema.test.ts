import { describe, expect, it } from "vitest";
import { validateSurveySchema } from "./validateSchema";

describe("validateSurveySchema", () => {
  it("returns true for valid survey schema", () => {
    const schema = {
      title: "Demo form",
      pages: [{ elements: [{ type: "text", name: "fullName" }] }],
    };

    expect(validateSurveySchema(schema)).toBe(true);
  });

  it("returns false when pages are missing", () => {
    expect(validateSurveySchema({ title: "Broken" })).toBe(false);
  });

  it("returns false when element has invalid shape", () => {
    const schema = {
      pages: [{ elements: [{ type: "text" }] }],
    };

    expect(validateSurveySchema(schema)).toBe(false);
  });
});
