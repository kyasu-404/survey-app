import { describe, expect, it } from "vitest";
import type { SurveySchema } from "../../entities/survey/types";
import { TEST_SIGNATURE_PNG } from "../../test/signatures";
import { createResponsesHtmlDocument, formatResponsesForTable, getResponsesPrintBlocks, RESPONSE_DATE_KEY } from "./responsesExport";

const questions = (start: number, count: number) => Array.from({ length: count }, (_, index) => ({ type: "text", name: `q${start + index}`, title: "Одинаковый заголовок" }));
const response = { id: "r", form_id: "f", created_at: "2026-09-11T09:00:00Z", data: {} };

describe("response print layout", () => {
  it("keeps up to eight answer columns in one table even across pages and sections", () => {
    const table = formatResponsesForTable([response], { pages: [
      { title: "Страница", elements: questions(1, 4) },
      { title: "Страница", elements: [{ type: "sectiontitle", name: "s", title: "Раздел" }, ...questions(5, 4)] },
    ] });
    const blocks = getResponsesPrintBlocks(table.columns);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].map(c => c.key)).toEqual([RESPONSE_DATE_KEY, ...questions(1, 8).map(q => `answer:${q.name}`)]);
  });

  it("splits a wide page by sections, then chunks wide sections, retaining unnamed pages, empty groups and legacy values", () => {
    const schema: SurveySchema = { pages: [
      { title: "Страница", elements: [
        ...questions(1, 2),
        { type: "sectiontitle", name: "s1", title: "Раздел" }, ...questions(3, 3),
        { type: "sectiontitle", name: "s2", title: "Раздел" }, ...questions(6, 9),
      ] },
      { elements: questions(15, 4) },
      { title: "Пустая страница", elements: [{ type: "sectiontitle", name: "empty", title: "Пустой раздел" }] },
    ] };
    const data = Object.fromEntries(questions(1, 18).map((q, index) => [q.name, `Ответ ${index + 1}`]));
    const table = formatResponsesForTable([{ ...response, data: { ...data, legacy: "Архивный" } }], schema);
    const blocks = getResponsesPrintBlocks(table.columns);
    expect(blocks.map(block => block.length - 1)).toEqual([2, 3, 8, 1, 4, 1, 1]);
    expect(blocks.every(block => block[0].key === RESPONSE_DATE_KEY)).toBe(true);
    expect(blocks.flatMap(block => block.filter(c => !c.isDate && !c.kind).map(c => c.key))).toEqual([
      ...questions(1, 18).map(q => `answer:${q.name}`), "answer:legacy",
    ]);
    expect(blocks[4][1].printPage?.header).toBe("Страница 2");
    expect(blocks[5][1]).toMatchObject({ key: "section:empty", page: { header: "Пустая страница" } });
    const doc = new DOMParser().parseFromString(createResponsesHtmlDocument({ title: "Отчёт", ...table }), "text/html");
    const print = doc.querySelector(".responses-report-print")!;
    expect(print.querySelectorAll("table")).toHaveLength(7);
    expect(print.querySelectorAll("th.responses-table-date-column")).toHaveLength(7);
    expect(Array.from(print.querySelectorAll("tbody td:not(.responses-table-date-column)"), cell => cell.textContent)).toEqual([
      ...questions(1, 18).map((_, index) => `Ответ ${index + 1}`), "", "Архивный",
    ]);
    expect(print.textContent).toContain("Пустая страница");
    expect(print.textContent).toContain("Пустой раздел");
  });

  it("uses technical chunks only when no structural boundaries are available", () => {
    const table = formatResponsesForTable([response], { pages: [{ elements: questions(1, 19) }] });
    expect(getResponsesPrintBlocks(table.columns).map(block => block.length - 1)).toEqual([8, 8, 3]);
    const html = createResponsesHtmlDocument({ title: "<Отчёт>", ...table });
    expect(html).toContain("@page responses-report { size: A4 landscape; margin: 10mm; }");
    expect(html).toContain("display: table-header-group");
    expect(html).toContain("min-width: 180px");
    expect(html).toContain("&lt;Отчёт&gt;");
    expect(html).not.toContain("<Отчёт>");
  });

  it("renders signatures as images in screen and print, leaving the source data untouched", () => {
    const schema = { pages: [{ elements: [
      { type: "signaturepad", name: "signature", title: "Подпись" },
      { type: "signaturepad", name: "invalid", title: "Подпись" },
      { type: "signaturepad", name: "empty", title: "Подпись" },
    ] }] };
    const table = formatResponsesForTable([{ ...response, data: { signature: TEST_SIGNATURE_PNG, invalid: 'data:image/png;base64,abc" onerror="alert(1)' } }], schema);
    const html = createResponsesHtmlDocument({ title: "Подписи", ...table });
    const doc = new DOMParser().parseFromString(html, "text/html");
    expect(doc.querySelectorAll("img")).toHaveLength(2);
    expect(doc.querySelector("img")?.getAttribute("src")).toBe(TEST_SIGNATURE_PNG);
    expect(doc.querySelector(".responses-report-screen")?.textContent).not.toContain("base64");
    expect(doc.querySelector(".responses-report-print")?.textContent).not.toContain("base64");
    expect(html).not.toContain("onerror");
    expect(table.rows[0]["answer:signature"]).toBe(TEST_SIGNATURE_PNG);
  });

  it("keeps empty reports readable without creating empty print tables", () => {
    const table = formatResponsesForTable([], { pages: [{ elements: questions(1, 19) }] });
    const html = createResponsesHtmlDocument({ title: "Ответы", ...table });
    expect(html).toContain("Ответов пока нет");
    expect(html).not.toContain("<table>");
  });
});
