import { describe, expect, it } from "vitest";
import type { SurveySchema } from "../../survey/types";
import { hasArchiveFileQuestions } from "./responseFiles";

describe("ZIP button availability", () => {
  it("recognizes nested and aliased file questions on every page", () => {
    const schema = { pages: [
      { elements: [{ type: "signaturepad", name: "signature" }] },
      { elements: [{ type: "panel", name: "panel", elements: [{ type: "paneldynamic", name: "people", templateElements: [
        { type: "file", name: "document", valueName: "proof" },
      ] }] }] },
    ] };
    expect(hasArchiveFileQuestions(schema)).toBe(true);
    expect(hasArchiveFileQuestions({ pages: [schema.pages[0]] })).toBe(false);
  });

  it("recognizes matrix file cells and detail elements", () => {
    const matrix = { type: "matrixdropdown", name: "matrix", cellType: "file", columns: [{ name: "proof" }] };
    const details = { type: "matrixdynamic", name: "rows", detailElements: [{ type: "file", name: "proof" }] };
    expect(hasArchiveFileQuestions({ pages: [{ elements: [matrix] }] } as SurveySchema)).toBe(true);
    expect(hasArchiveFileQuestions({ pages: [{ elements: [details] }] } as SurveySchema)).toBe(true);
  });
});
