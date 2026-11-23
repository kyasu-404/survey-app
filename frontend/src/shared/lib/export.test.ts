import { describe, expect, it } from "vitest";
import { createExcelWorkbook, neutralizeSpreadsheetFormula } from "./export";

describe("export utilities", () => {
  it("neutralizes spreadsheet formulas including leading whitespace", () => {
    expect(neutralizeSpreadsheetFormula("=SUM(A1:A2)")).toBe("\t=SUM(A1:A2)");
    expect(neutralizeSpreadsheetFormula("  +cmd|' /C calc'!A0")).toBe("\t  +cmd|' /C calc'!A0");
    expect(neutralizeSpreadsheetFormula("-1+1")).toBe("\t-1+1");
    expect(neutralizeSpreadsheetFormula("@SUM(1,2)")).toBe("\t@SUM(1,2)");
    expect(neutralizeSpreadsheetFormula("Обычный текст")).toBe("Обычный текст");
    expect(neutralizeSpreadsheetFormula(42)).toBe(42);
  });

  it("sanitizes invalid Excel worksheet name characters and enforces 31-character limit", async () => {
    const workbook = await createExcelWorkbook(
      [{ col: "значение" }],
      "'Отчёт: [2026]/итоги?*\\очень длинное название листа'",
    );
    const sheet = workbook.worksheets[0];
    expect(sheet.name.length).toBeLessThanOrEqual(31);
    expect(sheet.name).not.toMatch(/[*?:\\/[\]]/);
    expect(sheet.name).not.toMatch(/^'|'$/);
  });
});
