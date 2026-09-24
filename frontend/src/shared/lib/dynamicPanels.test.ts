import { describe, expect, it } from "vitest";
import type { SurveySchema } from "../../entities/survey/types";
import { formatResponsesForTable, createResponsesHtmlDocument } from "./responsesExport";
import { createExcelWorkbook } from "./export";
import { createResponseReport } from "./responseReport";

const response = { id: "r", form_id: "f", created_at: "2026-09-24T09:00:00Z" };
const schema: SurveySchema = { pages: [{ title: "Сведения", elements: [
  { type: "panel", name: "staff", title: "Кадры", elements: [
    { type: "paneldynamic", name: "people", title: "Сотрудники", templateElements: [
      { type: "text", name: "name", title: "Имя" },
      { type: "phone", name: "phone", title: "Телефон" },
      { type: "dropdown", name: "role", title: "Должность", choices: [{ value: "teacher", text: "Учитель" }] },
    ] },
  ] },
] }] };
const data = { people: [
  { name: "Даня", phone: "+7(111)-111-11-11", role: "teacher" },
  { name: "Артём", phone: "+7(222)-222-22-22", role: "teacher" },
] };
const expected = "Запись 1\nИмя: Даня\nТелефон: +7(111)-111-11-11\nДолжность: Учитель\n\nЗапись 2\nИмя: Артём\nТелефон: +7(222)-222-22-22\nДолжность: Учитель";

describe("dynamic panel answers", () => {
  it("formats numbered records with schema labels in the table, HTML, print and serialized XLSX", async () => {
    const table = formatResponsesForTable([{ ...response, data }], schema);
    expect(table.columns.map(c => c.header)).toEqual(["Дата ответа", "Сведения", "Кадры", "Сотрудники"]);
    expect(table.rows[0]["answer:people"]).toBe(expected);
    const html = createResponsesHtmlDocument({ title: "Сотрудники", ...table });
    const doc = new DOMParser().parseFromString(html, "text/html");
    expect(Array.from(doc.querySelectorAll("td.responses-table-multiline-column"), cell => cell.textContent)).toEqual([expected, expected]);
    expect(html).toContain("white-space: pre-wrap");
    const workbook = await createExcelWorkbook(table.rows, "Ответы", table.columns);
    const restored = await createExcelWorkbook([]);
    await restored.xlsx.load(await workbook.xlsx.writeBuffer());
    const sheet = restored.worksheets[0];
    expect(sheet.getCell("B4").text).toBe(expected);
    expect(sheet.getCell("B4").alignment).toMatchObject({ wrapText: true, vertical: "top" });
    expect(sheet.getRow(4).height).toBeGreaterThan(120);
    expect(sheet.getCell("B1").text).toBe("Сведения");
    expect(sheet.getCell("B2").text).toBe("Кадры");
    expect(data.people[0]).toEqual({ name: "Даня", phone: "+7(111)-111-11-11", role: "teacher" });
    const report = createResponseReport([{ ...response, data }], schema);
    expect(report.questionReports.map(q => q.name)).toEqual(["people.name", "people.phone", "people.role"]);
    expect(report.questionReports[0].groupTitles).toEqual(["Сведения", "Кадры", "Сотрудники"]);
    expect(report.questionReports[0].values.map(v => v.label)).toEqual(expect.arrayContaining(["Даня", "Артём"]));
  });

  it("keeps nested scopes, value names, choices, organizations, attachments and missing values distinct", () => {
    const nested: SurveySchema = { pages: [{ elements: [
      { type: "paneldynamic", name: "people", valueName: "staff", templateElements: [
        { type: "text", name: "display", valueName: "name", title: "Имя" },
        { type: "panel", name: "details", title: "Данные", elements: [
          { type: "organization", name: "org", title: "ОУ" },
          { type: "file", name: "files", title: "Файлы" },
          { type: "checkbox", name: "roles", title: "Роли", choices: [{ value: "a", text: "Первая" }] },
          { type: "boolean", name: "flag", title: "Признак" },
          { type: "number", name: "count", title: "Количество" },
        ] },
        { type: "paneldynamic", name: "children", title: "Дети", templateElements: [{ type: "text", name: "name", title: "Имя ребёнка" }] },
        { type: "text", name: "empty", title: "Не заполнено" },
      ] },
      { type: "dropdown", name: "roles", choices: [{ value: "a", text: "Внешняя" }] },
    ] }] };
    const table = formatResponsesForTable([{ ...response, data: { staff: [{ name: "Анна", org: "org-id", files: [{ name: "a.pdf", content: "https://example.test/a.pdf" }], roles: ["a"], flag: false, count: 0, children: [{ name: "Маша" }], extra: "Сохранено" }], roles: "a" } }], nested, new Map([["org-id", "Школа 1"]]));
    expect(table.rows[0]["answer:staff"]).toBe("Запись 1\nИмя: Анна\nДанные / ОУ: Школа 1\nДанные / Файлы: a.pdf\nДанные / Роли: Первая\nДанные / Признак: false\nДанные / Количество: 0\nДети:\n  Запись 1\n  Имя ребёнка: Маша\nНе заполнено: —\nextra: Сохранено");
    expect(table.rows[0]["answer:roles"]).toBe("Внешняя");
    expect(table.columns.map(c => c.key)).toEqual(["response-date", "answer:staff", "answer:roles"]);
  });

  it("escapes entry titles and answers and preserves empty and malformed entries without changing other question parsing", () => {
    const mixed: SurveySchema = { pages: [{ elements: [
      { type: "paneldynamic", name: "people", templateElements: [{ type: "text", name: "name", title: "<Имя>" }] },
      { type: "matrixdropdown", name: "matrix" },
      { type: "checkbox", name: "choice", choices: [{ value: "x", text: "Выбран" }] },
      { type: "file", name: "files" },
    ] }] };
    const table = formatResponsesForTable([{ ...response, data: { people: [{ name: "<script>alert(1)</script>" }, {}, "Старый ответ"], matrix: { row: { col: "x" } }, choice: ["x"], files: [{ name: "test.pdf", content: "secret" }] } }], mixed);
    expect(table.rows[0]["answer:people"]).toContain("Запись 2\n<Имя>: —\n\nЗапись 3: Старый ответ");
    expect(table.rows[0]["answer:matrix"]).toBe('{"row":{"col":"x"}}');
    expect(table.rows[0]["answer:choice"]).toBe("Выбран");
    expect(table.rows[0]["answer:files"]).toBe("test.pdf");
    const html = createResponsesHtmlDocument({ title: "Ответы", ...table });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;Имя&gt;");
    expect(formatResponsesForTable([{ ...response, data: { people: [] } }], mixed).rows[0]["answer:people"]).toBe("");
    const cycle: unknown[] = []; cycle.push(cycle);
    expect(formatResponsesForTable([{ ...response, data: { people: cycle } }], mixed).rows[0]["answer:people"]).toBe("[Значение превышает допустимую сложность]");
  });

  it("preserves all nested panel header levels in XLSX and restores the outer scope after leaving a panel", async () => {
    const table = formatResponsesForTable([{ ...response, data: { a: "Один", b: "Два", c: "Три" } }], { pages: [{ elements: [
      { type: "panel", name: "outer", title: "Раздел", elements: [
        { type: "panel", name: "inner", title: "Подраздел", elements: [{ type: "text", name: "a" }] },
        { type: "text", name: "b" },
      ] },
      { type: "text", name: "c" },
    ] }] });
    const workbook = await createExcelWorkbook(table.rows, "Ответы", table.columns);
    const sheet = workbook.worksheets[0];
    expect(sheet.getCell("B1").text).toBe("Раздел");
    expect(sheet.getCell("B2").text).toBe("Подраздел");
    expect(sheet.getCell("C2").text).toBe("");
    expect(sheet.getCell("D1").text).toBe("");
    expect((sheet.getRow(4).values as unknown[]).slice(2)).toEqual(["Один", "Два", "Три"]);
    expect(table.columns.find(c => c.key === "answer:b")?.section?.key).toBe("section:outer");
    expect(table.columns.find(c => c.key === "answer:c")?.section).toBeUndefined();
    const doc = new DOMParser().parseFromString(createResponsesHtmlDocument({ title: "Ответы", ...table }), "text/html");
    expect(doc.querySelectorAll(".responses-report-print thead tr")).toHaveLength(3);
  });
});
