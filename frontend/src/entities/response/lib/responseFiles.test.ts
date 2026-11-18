import { describe, expect, it } from "vitest";
import type { SurveySchema } from "../../survey/types";
import type { SurveyResponse } from "../types";
import { collectResponseAttachments, getArchiveQuestions, safeArchiveName } from "./responseFiles";

const attachment = (name = "Документ.pdf") => ({ name, type: "application/pdf", content: "public/form/file.pdf" });
const response = (data: Record<string, unknown>): SurveyResponse => ({ id: "r1", form_id: "form", created_at: "2026-09-13", data });

describe("response attachments", () => {
  it("finds files on every page and static panel, without exporting signatures or unrelated values", () => {
    const schema: SurveySchema = { pages: [
      { elements: [{ type: "signaturepad", name: "signature" }] },
      { elements: [{ type: "panel", name: "p", elements: [{ type: "file", name: "files" }] }] },
    ] };
    expect(getArchiveQuestions(schema).fileQuestions).toHaveLength(1);
    const files = collectResponseAttachments([response({ files: [attachment(), attachment()], signature: "data:image/png;base64,aA==", text: attachment() }), response({})], schema);
    expect(files.map(file => file.archivePath)).toEqual([
      "Ответ — 001/1_Документ.pdf",
      "Ответ — 001/2_Документ.pdf",
    ]);
    expect(getArchiveQuestions({ pages: [{ elements: [{ type: "signaturepad", name: "signature" }] }] }).fileQuestions).toEqual([]);
  });

  it("names folders by the first known organization and keeps the response number for duplicate or missing labels", () => {
    const schema: SurveySchema = { pages: [{ elements: [
      { type: "text", name: "freeText" },
      { type: "organization", name: "firstOrganization", valueName: "" },
      { type: "paneldynamic", name: "entries", templateElements: [
        { type: "organization", name: "organization", valueName: "school" },
      ] },
      { type: "file", name: "files" },
    ] }] };
    const answers = [
      { freeText: "other", entries: [{ school: "school" }] },
      { firstOrganization: "school", entries: [{ school: "other" }] },
      { freeText: "other", firstOrganization: "" },
      { firstOrganization: "missing-id" },
    ].map((data, index) => ({ ...response({ ...data, files: [attachment()] }), id: `r${index + 1}` }));

    const files = collectResponseAttachments(answers, schema, {
      organizationLabels: new Map([["school", "ГБОУ 373"], ["other", "Другая школа"]]),
    });
    expect(files.map(file => file.archivePath)).toEqual([
      "ГБОУ 373 — 001/1_Документ.pdf",
      "ГБОУ 373 — 002/1_Документ.pdf",
      "Ответ — 003/1_Документ.pdf",
      "Ответ — 004/1_Документ.pdf",
    ]);
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
