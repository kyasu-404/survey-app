import { describe, expect, it } from "vitest";
import { createResponsesHtmlDocument, formatResponsesForTable, getResponseTableHeaders } from "./responsesExport";

describe("responsesExport", () => {
  it("orders response columns by the form schema instead of response JSON key order", () => {
    const rows = formatResponsesForTable(
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

    expect(Object.keys(rows[0])).toEqual(["Дата ответа", "Вопрос 1", "Вопрос 2", "Вопрос 3"]);
    expect(getResponseTableHeaders(rows)).toEqual(["Дата ответа", "Вопрос 1", "Вопрос 2", "Вопрос 3"]);
  });

  it("formats response dates without seconds for the table and HTML export", () => {
    const rows = formatResponsesForTable(
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
    expect(rows[0]["Дата ответа"]).toMatch(/^\d{2}\.\d{2}\.\d{4}, \d{2}:\d{2}$/);
  });

  it("escapes form titles and response values in generated HTML", () => {
    const html = createResponsesHtmlDocument({
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
    const html = createResponsesHtmlDocument({
      title: "Ответы",
      rows: [{ Имя: "Анна" }],
      generatedAt: new Date("2026-04-13T09:00:00.000Z"),
    });

    expect(html).toContain("font-size: 13px;");
    expect(html).toContain("font-size: 28px;");
  });

  it("renders the response date column with a fixed width and wrapped time in generated HTML", () => {
    const html = createResponsesHtmlDocument({
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
    const html = createResponsesHtmlDocument({
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
    const html = createResponsesHtmlDocument({
      title: "Ответы",
      rows: [{ Имя: "Анна" }],
      generatedAt: new Date("2026-04-13T09:00:00.000Z"),
    });

    const generatedAtMatch = html.match(/<dt>Сформировано<\/dt><dd>(.*?)<\/dd>/);

    expect(generatedAtMatch?.[1]).toMatch(/^\d{2}\.\d{2}\.\d{4}, \d{2}:\d{2}$/);
  });

  it("keeps cell borders in downloaded HTML documents", () => {
    const html = createResponsesHtmlDocument({
      title: "Ответы",
      rows: [{ "Дата ответа": "15.04.2026, 16:11", Имя: "Анна" }],
      generatedAt: new Date("2026-04-13T09:00:00.000Z"),
    });

    expect(html).toContain("border: 1px solid #d8dee8;");
    expect(html).toContain("border-bottom: 1px solid #d8dee8;");
    expect(html).not.toContain("border-bottom: none;");
  });
});
