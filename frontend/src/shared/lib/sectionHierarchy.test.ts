import { describe, expect, it } from "vitest";
import type { SurveySchema } from "../../entities/survey/types";
import { formatResponsesForTable, createResponsesHtmlDocument, getResponseAnswerColumns, getResponsesPrintBlocks } from "./responsesExport";
import { createResponseReport } from "./responseReport";
import { createExcelWorkbook } from "./export";

const schema: SurveySchema = { pages: [
  { title: "Страница", elements: [
    { type: "text", name: "before" },
    { type: "sectiontitle", name: "h1", title: "Сведения" },
    { type: "text", name: "a" },
    { type: "panel", name: "p", title: "Контакты", elements: [
      { type: "text", name: "b" },
      { type: "sectiontitle", name: "inner", title: "Дополнительно" },
      { type: "text", name: "c" },
      { type: "panel", name: "deep", title: "Вложено", elements: [{ type: "text", name: "d" }] },
      { type: "sectiontitle", name: "inner2", title: "Дополнительно" },
      { type: "text", name: "e" },
    ] },
    { type: "text", name: "f" },
    { type: "sectiontitle", name: "h2", title: "Сведения" },
    { type: "text", name: "g" },
    { type: "sectiontitle", name: "empty", title: "Пустой <раздел>" },
  ] },
  { title: "Следующая", elements: [{ type: "text", name: "outside" }] },
] };
const response = { id: "r", form_id: "f", created_at: "2026-09-27T10:00:00Z", data: Object.fromEntries(["before", "a", "b", "c", "d", "e", "f", "g", "outside", "h1", "p"].map(name => [name, name])) };

describe("standalone headings and panel hierarchy", () => {
  it("keeps sibling headings, nested panels and page boundaries consistent with statistics", () => {
    const table = formatResponsesForTable([response], schema);
    const expected = { before: [], a: ["Сведения"], b: ["Сведения", "Контакты"], c: ["Сведения", "Контакты", "Дополнительно"], d: ["Сведения", "Контакты", "Дополнительно", "Вложено"], e: ["Сведения", "Контакты", "Дополнительно"], f: ["Сведения"], g: ["Сведения"], outside: [] };
    const report = createResponseReport([response], schema);
    for (const [name, titles] of Object.entries(expected)) {
      expect(table.columns.find(c => c.key === `answer:${name}`)?.sections?.map(s => s.header) ?? []).toEqual(titles);
      expect(report.questionReports.find(q => q.name === name)?.groupTitles).toEqual([name === "outside" ? "Следующая" : "Страница", ...titles]);
    }
    expect(report.questionReports).toHaveLength(9);
    expect(table.columns.some(c => c.key === "answer:h1" || c.key === "answer:p")).toBe(false);
    expect(table.columns.find(c => c.key === "answer:e")?.section?.key).toBe("section:inner2");
    expect(table.columns.find(c => c.key === "answer:g")?.section?.key).toBe("section:h2");
    expect(table.rows[0]["section:h1"]).toBe("");
    expect(getResponseAnswerColumns(table.columns).filter(c => c.kind === "section").map(c => c.key)).toEqual(["section:empty"]);
    expect(getResponsesPrintBlocks(table.columns).flat().some(c => c.key === "section:empty")).toBe(true);
    const html = createResponsesHtmlDocument({ title: "Ответы", ...table });
    expect(html).toContain("Пустой &lt;раздел&gt;");
    expect(html).not.toContain("<раздел>");
  });

  it("writes independent header rows without empty answer columns or merged cells in XLSX", async () => {
    const table = formatResponsesForTable([response], schema);
    const book = await createExcelWorkbook(table.rows, "Ответы", table.columns);
    const sheet = book.worksheets[0];
    expect(sheet.columnCount).toBe(11); // date + nine answers + one empty heading
    expect(sheet.model.merges).toEqual([]);
    expect(sheet.getCell("C2").text).toBe("Сведения");
    expect(sheet.getCell("D3").text).toBe("Контакты");
    expect(sheet.getCell("E4").text).toBe("Дополнительно");
    expect(sheet.getCell("F5").text).toBe("Вложено");
    expect(sheet.getCell("G4").text).toBe("Дополнительно");
    expect(sheet.getCell("I2").text).toBe("Сведения");
    expect(sheet.getCell("J2").text).toBe("Пустой <раздел>");
    expect(sheet.getCell("K2").text).toBe("");
    expect(sheet.getCell("F7").text).toBe("d");
  });

  it("applies the same scopes inside each dynamic record without exporting heading values", () => {
    const dynamic: SurveySchema = { pages: [{ elements: [{ type: "paneldynamic", name: "people", title: "Люди", templateElements: schema.pages[0].elements.slice(0, -1) }] }] };
    const data = { ...response, data: { people: [response.data, { a: "Второй" }] } };
    const text = formatResponsesForTable([data], dynamic).rows[0]["answer:people"];
    expect(text).toContain("Сведения / Контакты / Дополнительно / Вложено / d: d");
    expect(text).toContain("Сведения / f: f");
    expect(text).toContain("Запись 2\nbefore: —\nСведения / a: Второй");
    expect(text).not.toContain("h1:");
    expect(createResponseReport([data], dynamic).questionReports.find(q => q.name === "people.d")?.groupTitles).toEqual(["Люди", "Сведения", "Контакты", "Дополнительно", "Вложено"]);
  });
});
