import { describe, expect, it } from "vitest";
import { neutralizeSpreadsheetFormula } from "./export";

describe("export helpers", () => {
  it("neutralizes values that spreadsheet apps can execute as formulas", () => {
    expect(neutralizeSpreadsheetFormula("=IMPORTXML('https://example.test')")).toBe(
      "\t=IMPORTXML('https://example.test')",
    );
    expect(neutralizeSpreadsheetFormula(" +cmd|' /C calc'!A0")).toBe("\t +cmd|' /C calc'!A0");
    expect(neutralizeSpreadsheetFormula("-10")).toBe("\t-10");
    expect(neutralizeSpreadsheetFormula("@SUM(1,1)")).toBe("\t@SUM(1,1)");
  });

  it("keeps ordinary strings and non-string values unchanged", () => {
    expect(neutralizeSpreadsheetFormula("Ответ")).toBe("Ответ");
    expect(neutralizeSpreadsheetFormula(42)).toBe(42);
    expect(neutralizeSpreadsheetFormula(null)).toBeNull();
  });
});
