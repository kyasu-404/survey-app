import { describe, expect, it } from "vitest";
import { createResponsesHtmlDocument, formatResponsesForTable, RESPONSE_DATE_KEY, type ResponsesTableRow } from "./responsesExport";

// Older HTML style fixtures use display names as keys; production supplies explicit columns.
function createTestHtmlDocument(input: { title: string; rows: ResponsesTableRow[]; generatedAt: Date }) {
  const columns = Array.from(new Set(input.rows.flatMap(Object.keys)), (key) => ({
    key, header: key, isDate: key === "Дата ответа",
  }));
  return createResponsesHtmlDocument({ ...input, columns });
}

describe("responsesExport", () => {
  it("keeps repeated page and section titles as blank separators with distinct identities and resets groups on each page", () => {
    const title = "<Раздел>";
    const table = formatResponsesForTable([
      { id: "r1", form_id: "f1", created_at: "2026-09-10T09:00:00Z", data: { a: "Первый", b: "Второй", c: "Третий", d: "Четвёртый", s1: "Не ответ", legacy: "Архивный" } },
    ], { pages: [
      { title, elements: [
        { type: "sectiontitle", name: "s1", title },
        { type: "text", name: "a", title },
        { type: "panel", name: "panel", elements: [
          { type: "sectiontitle", name: "s2", title },
          { type: "text", name: "b", title },
        ] },
      ] },
      { title, elements: [
        { type: "text", name: "c", title },
        { type: "sectiontitle", name: "empty", title: "Пустой раздел" },
      ] },
      { name: "technical-name", title: "  ", elements: [{ type: "text", name: "d", title }] },
      { title: "Пустая страница", elements: [] },
    ] });

    expect(table.columns.map(c => c.key)).toEqual([
      RESPONSE_DATE_KEY, "page:0", "section:s1", "answer:a", "section:s2", "answer:b",
      "page:1", "answer:c", "section:empty", "answer:d", "page:3", "answer:legacy",
    ]);
    expect(table.columns.map(c => table.rows[0][c.key]).slice(1)).toEqual([
      "", "", "Первый", "", "Второй", "", "Третий", "", "Четвёртый", "", "Архивный",
    ]);
    expect(table.columns.find(c => c.key === "answer:b")).toMatchObject({ page: { key: "page:0" }, section: { key: "section:s2" } });
    expect(table.columns.find(c => c.key === "answer:c")?.section).toBeUndefined();
    for (const key of ["answer:d", "answer:legacy"]) {
      expect(table.columns.find(c => c.key === key)?.page).toBeUndefined();
      expect(table.columns.find(c => c.key === key)?.section).toBeUndefined();
    }
    const doc = new DOMParser().parseFromString(createResponsesHtmlDocument({ title: "Ответы", ...table }), "text/html");
    expect(doc.querySelectorAll("th.responses-table-page-column")).toHaveLength(3);
    expect(doc.querySelectorAll("th.responses-table-section-column")).toHaveLength(3);
    expect(doc.querySelectorAll("tbody td.responses-table-page-column, tbody td.responses-table-section-column")).toHaveLength(6);
    expect(Array.from(doc.querySelectorAll("th"), c => c.textContent)).toEqual(table.columns.map(c => c.header));
    expect(doc.querySelector("раздел")).toBeNull();
  });

  it("keeps every duplicated question and its own answer, including empty comments, across pages and panels", () => {
    const header = "КОММЕНТАРИИ. Если не выполнено, то почему?";
    const table = formatResponsesForTable([
      { id: "r1", form_id: "f1", created_at: "2026-09-10T09:00:00Z", data: { c3: "Третий", c1: "Первый" } },
      { id: "r2", form_id: "f1", created_at: "2026-09-10T10:00:00Z", data: { c2: "Второй" } },
    ], { pages: [
      { elements: [
        { type: "comment", name: "c1", title: header },
        { type: "panel", name: "group", elements: [{ type: "comment", name: "c2", title: header }] },
      ] },
      { elements: [
        { type: "comment", name: "c3", title: header },
        { type: "comment", name: "c4", title: header },
      ] },
    ] });

    expect(table.columns.map((column) => column.header)).toEqual(["Дата ответа", header, header, header, header]);
    expect(table.columns.map((column) => table.rows[0][column.key])).toEqual([expect.any(String), "Первый", "", "Третий", ""]);
    expect(table.columns.map((column) => table.rows[1][column.key])).toEqual([expect.any(String), "", "Второй", "", ""]);
    const document = new DOMParser().parseFromString(createResponsesHtmlDocument({ title: "ИБ школы", ...table }), "text/html");
    expect(Array.from(document.querySelectorAll("th"), (cell) => cell.textContent)).toEqual(["Дата ответа", header, header, header, header]);
    expect(Array.from(document.querySelectorAll("tbody tr:first-child td"), (cell) => cell.textContent).slice(1)).toEqual(["Первый", "", "Третий", ""]);
  });

  it("preserves identity and schema order for date, numeric, special, and colliding legacy headers", () => {
    const table = formatResponsesForTable([
      { id: "r1", form_id: "f1", created_at: "2026-09-10T09:00:00Z", data: { q1: "Своя дата", q2: "Десять", q3: "Два", q4: "Текст", q5: "Основной" } },
      { id: "r2", form_id: "f1", created_at: "2026-09-10T09:00:00Z", data: JSON.parse('{"Совпадение":"Архивный","__proto__":"Сохранённый"}') },
    ], { pages: [{ elements: [
      { type: "text", name: "q1", title: "Дата ответа" },
      { type: "text", name: "q2", title: "10" },
      { type: "text", name: "q3", title: "2" },
      { type: "text", name: "q4", title: "__proto__" },
      { type: "text", name: "q5", title: "Совпадение" },
    ] }] });

    expect(table.columns.map((column) => column.header)).toEqual(["Дата ответа", "Дата ответа", "10", "2", "__proto__", "Совпадение", "Совпадение", "__proto__"]);
    expect(new Set(table.columns.map((column) => column.key)).size).toBe(8);
    expect(table.columns.map((column) => table.rows[1][column.key]).slice(1)).toEqual(["", "", "", "", "", "Архивный", "Сохранённый"]);
    const document = new DOMParser().parseFromString(createResponsesHtmlDocument({ title: "Ответы", ...table }), "text/html");
    expect(document.querySelectorAll("th.responses-table-date-column")).toHaveLength(1);
    expect(document.querySelector("tbody tr td:nth-child(2)")?.textContent).toBe("Своя дата");
  });

  it("keeps compound answers in their own columns without treating their items as standalone questions", () => {
    const table = formatResponsesForTable([
      { id: "r1", form_id: "f1", created_at: "2026-09-10T09:00:00Z", data: {
        repeated: [{ name: "Запись", child: "Первый" }, { child: "Второй" }], matrix: { name: "Имя", row: { column: "Ячейка" } },
      } },
    ], { pages: [{ elements: [
      { type: "html", name: "intro" },
      { type: "image", name: "picture" },
      { type: "paneldynamic", name: "repeated", title: "Повторы", templateElements: [{ type: "text", name: "child" }] },
      { type: "matrixdropdown", name: "matrix", title: "Матрица", columns: [{ name: "column" }] },
    ] }] } as never);
    expect(table.columns.map((column) => column.header)).toEqual(["Дата ответа", "Повторы", "Матрица"]);
    expect(table.rows[0]["answer:repeated"]).toContain("Первый");
    expect(table.rows[0]["answer:repeated"]).toContain("Второй");
    expect(table.rows[0]["answer:repeated"]).not.toContain("[object Object]");
    expect(table.rows[0]["answer:matrix"]).toContain("Ячейка");
  });

  it("maps choices and organization labels by question name even when titles match", () => {
    const table = formatResponsesForTable([
      { id: "r1", form_id: "f1", created_at: "2026-09-10T09:00:00Z", data: { first: "1", second: ["1"], org: "org-id", flag: false, number: 0 } },
    ], { pages: [{ elements: [
      { type: "dropdown", name: "first", title: "Выбор", choices: [{ value: "1", text: "Первый" }] },
      { type: "checkbox", name: "second", title: "Выбор", choices: [{ value: "1", text: "Второй" }] },
      { type: "organization", name: "org", title: "Выбор" },
      { type: "boolean", name: "flag" },
      { type: "text", name: "number" },
    ] }] }, new Map([["org-id", "Школа"]]));
    expect(table.columns.map((column) => table.rows[0][column.key]).slice(1)).toEqual(["Первый", "Второй", "Школа", "false", "0"]);
  });

  it("orders response columns by the form schema instead of response JSON key order", () => {
    const { rows, columns } = formatResponsesForTable(
      [
        {
          id: "response-1",
          form_id: "form-1",
          created_at: "2026-04-15T13:11:00.000Z",
          data: {
            q3: "Третий",
            q1: "Первый",
            q2: "Второй",
          },
        },
      ],
      {
        pages: [
          {
            elements: [
              { type: "text", name: "q1", title: "Вопрос 1" },
              { type: "text", name: "q2", title: "Вопрос 2" },
              { type: "text", name: "q3", title: "Вопрос 3" },
            ],
          },
        ],
      },
    );

    expect(columns.map((column) => column.header)).toEqual(["Дата ответа", "Вопрос 1", "Вопрос 2", "Вопрос 3"]);
    expect(columns.map((column) => rows[0][column.key])).toEqual([expect.any(String), "Первый", "Второй", "Третий"]);
  });

  it("formats response dates without seconds for the table and HTML export", () => {
    const { rows } = formatResponsesForTable(
      [
        {
          id: "response-1",
          form_id: "form-1",
          created_at: "2026-04-15T13:11:00.000Z",
          data: {},
        },
      ],
      {
        pages: [
          {
            elements: [],
          },
        ],
      },
    );

    expect(rows).toHaveLength(1);
    expect(rows[0][RESPONSE_DATE_KEY]).toMatch(/^\d{2}\.\d{2}\.\d{4}, \d{2}:\d{2}$/);
  });

  it("escapes form titles and response values in generated HTML", () => {
    const html = createTestHtmlDocument({
      title: '<img src=x onerror="alert(1)">',
      rows: [
        {
          "Дата ответа": "13.04.2026, 12:00:00",
          Имя: '<script>alert("xss")</script>',
        },
      ],
      generatedAt: new Date("2026-04-13T09:00:00.000Z"),
    });

    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;");
    expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
  });

  it("uses a slightly smaller text scale in generated HTML documents", () => {
    const html = createTestHtmlDocument({
      title: "Ответы",
      rows: [{ Имя: "Анна" }],
      generatedAt: new Date("2026-04-13T09:00:00.000Z"),
    });

    expect(html).toContain("font-size: 13px;");
    expect(html).toContain("font-size: 28px;");
  });

  it("renders the response date column with a fixed width and wrapped time in generated HTML", () => {
    const html = createTestHtmlDocument({
      title: "Ответы",
      rows: [{ "Дата ответа": "15.04.2026, 16:11", Имя: "Анна" }],
      generatedAt: new Date("2026-04-13T09:00:00.000Z"),
    });

    expect(html).toContain(".responses-table-date-column");
    expect(html).toContain("width: 12ch;");
    expect(html).toContain("min-width: 12ch;");
    expect(html).toContain("width: max-content;");
    expect(html).toContain('<th class="responses-table-date-column">Дата ответа</th>');
    expect(html).toContain('<td class="responses-table-date-column"><span class="responses-table-date-cell">');
    expect(html).toContain('<span class="responses-table-date-line">15.04.2026</span>');
    expect(html).toContain('<span class="responses-table-date-line">16:11</span>');
    expect(html).not.toContain("16:11:00");
  });

  it("wraps long response headers and cell values in generated HTML documents", () => {
    const html = createTestHtmlDocument({
      title: "Ответы",
      rows: [
        {
          "Очень длинный заголовок столбца для проверки переноса текста": "Очень длинное значение без потери читаемости",
        },
      ],
      generatedAt: new Date("2026-04-13T09:00:00.000Z"),
    });

    expect(html).toContain("white-space: normal;");
    expect(html).toContain("overflow-wrap: anywhere;");
    expect(html).toContain("word-break: break-word;");
    expect(html).toContain("max-width: min(28rem, 40vw);");
  });

  it("renders generated-at metadata without seconds in generated HTML", () => {
    const html = createTestHtmlDocument({
      title: "Ответы",
      rows: [{ Имя: "Анна" }],
      generatedAt: new Date("2026-04-13T09:00:00.000Z"),
    });

    const generatedAtMatch = html.match(/<dt>Сформировано<\/dt><dd>(.*?)<\/dd>/);

    expect(generatedAtMatch?.[1]).toMatch(/^\d{2}\.\d{2}\.\d{4}, \d{2}:\d{2}$/);
  });

  it("keeps cell borders in downloaded HTML documents", () => {
    const html = createTestHtmlDocument({
      title: "Ответы",
      rows: [{ "Дата ответа": "15.04.2026, 16:11", Имя: "Анна" }],
      generatedAt: new Date("2026-04-13T09:00:00.000Z"),
    });

    expect(html).toContain("border: 1px solid #d8dee8;");
    expect(html).toContain("border-bottom: 1px solid #d8dee8;");
    expect(html).not.toContain("border-bottom: none;");
  });

  it("bounds deeply nested response values instead of overflowing the export stack", () => {
    const deeplyNested: Record<string, unknown> = {};
    let cursor = deeplyNested;
    for (let depth = 0; depth < 100; depth += 1) {
      const next: Record<string, unknown> = {};
      cursor.next = next;
      cursor = next;
    }

    const { rows } = formatResponsesForTable(
      [
        {
          id: "response-deep",
          form_id: "form-1",
          created_at: "2026-04-15T13:11:00.000Z",
          data: { answer: deeplyNested },
        },
      ],
      { pages: [] },
    );

    expect(rows[0]["answer:answer"]).toBe("[Значение превышает допустимую сложность]");
  });

  it("bounds deeply nested question containers and tolerates malformed page collections", () => {
    const root: Record<string, unknown> = { type: "panel", name: "root" };
    let cursor = root;
    for (let depth = 0; depth < 100; depth += 1) {
      const next: Record<string, unknown> = { type: "panel", name: `panel-${depth}` };
      cursor.elements = [next];
      cursor = next;
    }

    expect(() =>
      formatResponsesForTable(
        [
          {
            id: "response-1",
            form_id: "form-1",
            created_at: "2026-04-15T13:11:00.000Z",
            data: {},
          },
        ],
        { pages: [{ elements: [root] }] } as never,
      ),
    ).not.toThrow();

    expect(() => formatResponsesForTable([], { pages: null } as never)).not.toThrow();
  });
});
