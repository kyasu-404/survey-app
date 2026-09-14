import { describe, expect, it } from "vitest";
import type { SurveySchema } from "../../entities/survey/types";
import type { SurveyResponse } from "../../entities/response/types";
import { collectResponseAttachments, getFileQuestions, safeArchiveName } from "./responseFiles";

const attachment = (name = "Документ.pdf") => ({ name, type: "application/pdf", content: "public/form/file.pdf" });
const response = (data: Record<string, unknown>): SurveyResponse => ({ id: "r1", form_id: "form", created_at: "2026-09-13", data });

describe("response attachments", () => {
  it("finds files on every page and static panel, without exporting signatures or unrelated values", () => {
    const schema: SurveySchema = { pages: [
      { elements: [{ type: "signaturepad", name: "signature" }] },
      { elements: [{ type: "panel", name: "p", elements: [{ type: "file", name: "files" }] }] },
    ] };
    expect(getFileQuestions(schema)).toHaveLength(1);
    const files = collectResponseAttachments([response({ files: [attachment(), attachment()], signature: "data:image/png;base64,aA==", text: attachment() }), response({})], schema);
    expect(files).toHaveLength(2);
    expect(new Set(files.map(file => file.archivePath)).size).toBe(2);
    expect(files.every(file => file.archivePath.endsWith("Документ.pdf"))).toBe(true);
    expect(getFileQuestions({ pages: [{ elements: [{ type: "signaturepad", name: "signature" }] }] })).toEqual([]);
  });

  it("collects repeated panels, matrix file cells, localized titles and valueName aliases", () => {
    const schema = { pages: [{ elements: [
      { type: "paneldynamic", name: "people", templateElements: [
        { type: "file", name: "document", valueName: "attachment", title: { ru: "Документы" } },
      ] },
      { type: "matrixdropdown", name: "matrix", cellType: "file", columns: [{ name: "proof" }, { name: "note", cellType: "text" }] },
      { type: "matrixdynamic", name: "dynamic", columns: [{ name: "proof", cellType: "file" }] },
    ] }] } as unknown as SurveySchema;
    const data = {
      people: [{ attachment: [attachment("1.pdf")] }, { attachment: [attachment("2.pdf")] }],
      matrix: { row1: { proof: [attachment("3.pdf")], note: attachment("ignore.pdf") } },
      dynamic: [{ proof: [attachment("4.pdf")] }],
    };
    expect(collectResponseAttachments([response(data)], schema).map(file => file.value)).toEqual([attachment("1.pdf"), attachment("2.pdf"), attachment("3.pdf"), attachment("4.pdf")]);
  });

  it("keeps duplicate filenames and question titles separate and neutralizes extraction paths", () => {
    const schema = { pages: [{ elements: [{ type: "file", name: "a", title: "../Раздел" }, { type: "file", name: "b", title: "../Раздел" }] }] };
    const files = collectResponseAttachments([response({ a: [attachment("../../CON.pdf")], b: attachment("../../CON.pdf") }), response({ a: [attachment("../../CON.pdf")] })], schema);
    expect(files).toHaveLength(3);
    expect(new Set(files.map(file => file.archivePath)).size).toBe(3);
    expect(files.every(file => file.archivePath.split("/").length === 3)).toBe(true);
    expect(safeArchiveName("NUL.txt", "файл")).toBe("_NUL.txt");
    expect(safeArchiveName("a".repeat(150) + ".xlsx", "файл")).toMatch(/\.xlsx$/);
    expect(safeArchiveName("../\u0000x\\y.pdf", "файл")).not.toMatch(/[/\\\u0000]/);
  });
});
