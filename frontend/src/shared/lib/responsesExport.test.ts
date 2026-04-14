import { describe, expect, it } from "vitest";
import { createResponsesHtmlDocument } from "./responsesExport";

describe("responsesExport", () => {
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
});
