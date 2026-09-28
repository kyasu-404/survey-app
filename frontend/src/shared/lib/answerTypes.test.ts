import { describe, expect, it } from "vitest";
import { Model } from "survey-core";
import { QUESTION_TYPES, registerCustomSurveyQuestionTypes } from "../../entities/survey/model/surveyQuestionTypes";
import type { SurveyQuestion, SurveySchema } from "../../entities/survey/types";
import { formatResponsesForTable, createResponsesHtmlDocument } from "./responsesExport";
import { createExcelWorkbook } from "./export";
import { createResponseReport } from "./responseReport";

const choice = [{ value: "a", text: "Первый" }, { value: "b", text: "Второй" }];
const cases: Array<[string, unknown, string, Record<string, unknown>?]> = [
  ["text", "Текст", "Текст"], ["comment", "Строка 1\nСтрока 2", "Строка 1\nСтрока 2"],
  ["radiogroup", "a", "Первый", { choices: choice }], ["checkbox", ["a", "other"], "Первый, Свой вариант", { choices: choice, showOtherItem: true }],
  ["dropdown", "other", "Свой вариант", { choices: choice, showOtherItem: true }],
  ["organization", "school", "Школа №1"], ["number", 1.5, "1.5"], ["integer", 0, "0"],
  ["date", "2026-09-24", "24.09.2026"], ["time", "10:15", "10:15"], ["datetime", "2026-09-24T10:15", "24.09.2026 10:15"],
  ["phone", "+7(111)-111-11-11", "+7(111)-111-11-11"], ["email", "test@example.test", "test@example.test"],
  ["boolean", false, "Нет"], ["rating", 4, "4"], ["ranking", ["b", "a"], "1. Второй\n2. Первый", { choices: choice }],
  ["tagbox", ["b"], "Второй", { choices: choice }],
  ["matrix", { r1: "a", r2: "b" }, "Первая строка: Первый\nВторая строка: Второй", { rows: [{ value: "r1", text: "Первая строка" }, { value: "r2", text: "Вторая строка" }], columns: choice }],
  ["matrixdropdown", { r1: { col: "b" } }, "Первая строка\n  Столбец: Второй", { rows: [{ value: "r1", text: "Первая строка" }], columns: [{ name: "col", title: "Столбец", choices: choice }] }],
  ["matrixdynamic", [{ col: "a" }, { col: "b" }], "Строка 1\nСтолбец: Первый\n\nСтрока 2\nСтолбец: Второй", { columns: [{ name: "col", title: "Столбец", choices: choice }] }],
  ["multipletext", { name: "Анна", count: 0 }, "Имя: Анна\nЧисло: 0", { items: [{ name: "name", title: "Имя" }, { name: "count", title: "Число", inputType: "number" }] }],
  ["imagepicker", "b", "Второй", { choices: choice }], ["file", [{ name: "файл.pdf", content: "private/path" }], "файл.pdf"],
  ["signaturepad", "data:image/png;base64,fixture", "data:image/png;base64,fixture"],
  ["paneldynamic", [{ child: "other", "child-Comment": "Вложенный вариант" }], "Запись 1\nВыбор: Вложенный вариант", { templateElements: [{ type: "dropdown", name: "child", title: "Выбор", showOtherItem: true }] }],
  ["expression", 42, "42"],
];
const makeResponse = (data: Record<string, unknown>) => ({ id: "r", form_id: "f", created_at: "2026-09-24T10:00:00Z", data });
describe("all toolbox answer types", () => {
  it.each(cases)("formats %s with no loss of values", (type, value, expected, properties) => {
    const question = { type, name: "q", ...properties } as SurveyQuestion;
    const data = { q: value, ...(properties?.showOtherItem ? { "q-Comment": "Свой вариант" } : {}) };
    const table = formatResponsesForTable([makeResponse(data)], { pages: [{ elements: [question] }] }, new Map([["school", "Школа №1"]]));
    expect(table.rows[0]["answer:q"]).toBe(expected);
    expect(table.columns.map(c => c.key)).toEqual(["response-date", "answer:q"]);
    expect(data.q).toEqual(value);
  });

  it("covers the entire toolbox including non-answer elements", () => {
    expect(new Set([...cases.map(([type]) => type), "panel", "sectiontitle", "image", "html"])).toEqual(new Set(QUESTION_TYPES));
    const table = formatResponsesForTable([makeResponse({})], { pages: [{ elements: [
      { type: "panel", name: "section", elements: [] }, { type: "image", name: "image" }, { type: "html", name: "html" },
    ] }] });
    expect(table.columns.map(c => c.key)).toEqual(["response-date", "section:section"]);
  });

  it("round-trips actual SurveyJS Other data through table, HTML, XLSX and statistics", async () => {
    registerCustomSurveyQuestionTypes();
    const schema: SurveySchema = { pages: [{ elements: [{ type: "dropdown", name: "q", title: "Выбор", ...{ choices: choice, showOtherItem: true } }] }] };
    const model = new Model(schema); model.getQuestionByName("q").value = "other"; model.getQuestionByName("q").comment = "<Мой вариант>";
    expect(model.data).toEqual({ q: "other", "q-Comment": "<Мой вариант>" });
    const responses = [makeResponse(model.data)];
    const table = formatResponsesForTable(responses, schema);
    expect(table.rows[0]["answer:q"]).toBe("<Мой вариант>");
    const html = createResponsesHtmlDocument({ title: "Ответы", ...table });
    expect(html).toContain("&lt;Мой вариант&gt;"); expect(html).not.toContain("q-Comment");
    const workbook = await createExcelWorkbook(table.rows, "Ответы", table.columns);
    expect(workbook.worksheets[0].getCell("B2").text).toBe("<Мой вариант>");
    expect(createResponseReport(responses, schema).questionReports[0].values).toContainEqual({ label: "<Мой вариант>", count: 1, percentage: 100 });
    model.dispose();
  });

  it("formats numeric choices, custom boolean labels, valueName, comment suffix and matrix cell choices", () => {
    const elements = [
      { type: "dropdown", name: "display", valueName: "stored", choices: [{ value: 0, text: "Ноль" }], showCommentArea: true },
      { type: "boolean", name: "bool", valueTrue: "yes", valueFalse: "no", labelFalse: "Не согласен" },
      { type: "matrixdynamic", name: "m", columns: [{ name: "c", title: "Выбор", cellType: "dropdown", showOtherItem: true }] },
    ] as unknown as SurveyQuestion[];
    const responses = [makeResponse({ stored: 0, stored_note: "Пояснение", bool: "no", m: [{ c: "other", c_note: "Свой" }] })];
    const schema = { commentSuffix: "_note", pages: [{ elements }] };
    const table = formatResponsesForTable(responses, schema);
    expect(table.rows[0]["answer:stored"]).toBe("Ноль\nКомментарий: Пояснение");
    expect(table.rows[0]["answer:bool"]).toBe("Не согласен");
    expect(table.rows[0]["answer:m"]).toBe("Строка 1\nВыбор: Свой");
    expect(table.columns).toHaveLength(4);
    const reports = createResponseReport(responses, schema).questionReports;
    expect(reports[1].values).toContainEqual({ label: "Не согласен", count: 1, percentage: 100 });
    expect(reports[2].groups).toHaveLength(1);
    expect(reports[2].groups[0].values).toEqual([{ label: "Свой", count: 1, percentage: 100 }]);
  });

  it("does not mistake free Other text for a choice code in statistics", () => {
    const schema = { pages: [{ elements: [{ type: "dropdown", name: "q", choices: choice, showOtherItem: true }] }] };
    const report = createResponseReport([makeResponse({ q: "other", "q-Comment": "a" })], schema);
    expect(report.questionReports[0].values).toContainEqual({ label: "a", count: 1, percentage: 100 });
    expect(report.questionReports[0].values).toContainEqual({ label: "Первый", count: 0, percentage: 0 });
  });
});
