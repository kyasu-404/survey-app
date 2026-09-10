import { describe, expect, it } from "vitest";
import { createExcelWorkbook, neutralizeSpreadsheetFormula } from "./export";
import { formatResponsesForTable } from "./responsesExport";
import type { SurveySchema } from "../../entities/survey/types";
import { TEST_SIGNATURE_PNG } from "../../test/signatures";

describe("export helpers", () => {
  it("embeds signatures in their answer cells with grouping offsets and leaves empty or invalid signatures readable", async () => {
    const schema: SurveySchema = { pages: [{ title: "Страница", elements: [
      { type: "sectiontitle", name: "section", title: "Раздел" },
      { type: "signaturepad", name: "sign", title: "Подпись" },
      { type: "signaturepad", name: "other", title: "Подпись" },
      { type: "text", name: "text", title: "Текст" },
    ] }] };
    const table = formatResponsesForTable([
      { id: "1", form_id: "f", created_at: "2026-09-11T09:00:00Z", data: { sign: TEST_SIGNATURE_PNG, other: TEST_SIGNATURE_PNG, text: "=1+1" } },
      { id: "2", form_id: "f", created_at: "2026-09-11T09:00:00Z", data: { sign: "data:image/png;base64,bad", text: "Конец" } },
    ], schema);
    const workbook = await createExcelWorkbook(table.rows, "Ответы", table.columns);
    const restored = await createExcelWorkbook([]);
    await restored.xlsx.load(await workbook.xlsx.writeBuffer());
    const sheet = restored.worksheets[0];
    expect(sheet.getCell("B4").text).toBe("");
    expect(sheet.getCell("C4").text).toBe("");
    expect(sheet.getCell("D4").value).toBe("\t=1+1");
    expect(sheet.getCell("B5").text).toBe("Не удалось отобразить подпись");
    expect(sheet.getCell("C5").text).toBe("");
    expect(sheet.getCell("D5").text).toBe("Конец");
    const images = sheet.getImages();
    expect(images).toHaveLength(2);
    expect(images.map(image => [image.range.tl.nativeCol, image.range.tl.nativeRow])).toEqual([[1, 3], [2, 3]]);
    expect(sheet.getRow(4).height).toBe(78);
    expect(sheet.getColumn(2).width).toBeGreaterThanOrEqual(28);
    expect(restored.getImage(Number(images[0].imageId)).extension).toBe("png");
    expect(sheet.getCell("B4").border.bottom?.style).toBe("thin");
    expect(sheet.model.merges).toEqual([]);
    expect(table.rows[0]["answer:sign"]).toBe(TEST_SIGNATURE_PNG);
  });
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

  it("writes page and section groups above their own answers, including repeated titles and empty groups", async () => {
    const schema: SurveySchema = { pages: [
      { title: "Страница", elements: [
        { type: "text", name: "intro", title: "До разделов" },
        { type: "sectiontitle", name: "s1", title: "Раздел" },
        { type: "text", name: "q1", title: "Ответ" },
        { type: "text", name: "q2", title: "Ответ" },
        { type: "sectiontitle", name: "s2", title: "Раздел" },
        { type: "text", name: "q3", title: "Ответ" },
      ] },
      { title: "Страница", elements: [
        { type: "text", name: "q4", title: "Без раздела" },
        { type: "sectiontitle", name: "empty", title: "Пустой раздел" },
      ] },
      { elements: [{ type: "text", name: "q5", title: "Без страницы" }] },
      { title: "Пустая страница", elements: [] },
    ] };
    const table = formatResponsesForTable([
      { id: "r", form_id: "f", created_at: "2026-09-10T09:00:00Z", data: { intro: "Вступление", q1: "Один", q2: "Два", q3: "Три", q4: "Четыре", q5: "Пять", legacy: "Архивный" } },
    ], schema);
    const workbook = await createExcelWorkbook(table.rows, "Ответы", table.columns);
    // Read the serialized XLSX back, checking the file contract rather than the builder alone.
    const buffer = await workbook.xlsx.writeBuffer();
    const restored = await createExcelWorkbook([]);
    await restored.xlsx.load(buffer);
    const sheet = restored.worksheets[0];
    expect(sheet.model.merges).toEqual([]);
    expect(sheet.getCell("B1").text).toBe("Страница");
    expect(sheet.getCell("F1").text).toBe("Страница");
    expect(sheet.getCell("C2").text).toBe("Раздел");
    expect(sheet.getCell("E2").text).toBe("Раздел");
    expect(sheet.getCell("C1").text).toBe("");
    expect(sheet.getCell("D2").text).toBe("");
    expect(sheet.getCell("F2").text).toBe("");
    expect(sheet.getCell("G2").text).toBe("Пустой раздел");
    expect(sheet.getCell("H1").text).toBe("");
    expect(sheet.getCell("H2").text).toBe("");
    expect(sheet.getCell("I1").text).toBe("Пустая страница");
    expect(sheet.getCell("J1").text).toBe("");
    expect(sheet.getCell("J2").text).toBe("");
    expect((sheet.getRow(3).values as unknown[]).slice(1)).toEqual([
      "Дата ответа", "До разделов", "Ответ", "Ответ", "Ответ", "Без раздела", "", "Без страницы", "", "legacy",
    ]);
    expect((sheet.getRow(4).values as unknown[]).slice(2)).toEqual(["Вступление", "Один", "Два", "Три", "Четыре", "", "Пять", "", "Архивный"]);
    expect(sheet.getCell("B1").fill).toMatchObject({ fgColor: { argb: "FFDBEAFE" } });
    expect(sheet.getCell("C2").font.bold).toBe(true);
    expect(sheet.views[0]).toMatchObject({ state: "frozen", ySplit: 3 });
    expect(sheet.pageSetup.printTitlesRow).toBe("1:3");
    expect(sheet.rowCount).toBe(4);
    expect(sheet.columnCount).toBe(10);
    for (let row = 1; row <= sheet.rowCount; row += 1) {
      for (let column = 1; column <= sheet.columnCount; column += 1) {
        const border = sheet.getRow(row).getCell(column).border;
        expect(border.top?.style).toBe("thin");
        expect(border.bottom?.style).toBe("thin");
        expect(border.right?.style).toBe("thin");
        expect(border.left?.style).toBe([2, 3, 5, 6, 7, 8, 9, 10].includes(column) ? "medium" : "thin");
      }
    }
  });

  it.each(["page", "section"] as const)("uses just one grouping row for %s-only forms and neutralizes group and answer formulas", async (kind) => {
    const table = formatResponsesForTable([
      { id: "r", form_id: "f", created_at: "2026-09-10T09:00:00Z", data: { answer: "=1+1" } },
    ], { pages: [{ title: kind === "page" ? "=Title" : undefined, elements: [
      ...(kind === "section" ? [{ type: "sectiontitle", name: "s", title: "=Title" }] : []),
      { type: "text", name: "answer", title: "+Answer" },
    ] }] });
    const workbook = await createExcelWorkbook(table.rows, "Ответы", table.columns);
    const sheet = workbook.worksheets[0];
    expect(sheet.getCell("B1").value).toBe("\t=Title");
    expect(sheet.getCell("B2").value).toBe("\t+Answer");
    expect(sheet.getCell("B3").value).toBe("\t=1+1");
    expect(sheet.rowCount).toBe(3);
    expect(sheet.columnCount).toBe(2);
  });

  it("keeps the original single header row when there are no structural titles", async () => {
    const workbook = await createExcelWorkbook([{ First: "a" }, { Second: "b", First: "c" }]);
    const sheet = workbook.worksheets[0];
    expect((sheet.getRow(1).values as unknown[]).slice(1)).toEqual(["First", "Second"]);
    expect(sheet.getCell("A2").text).toBe("a");
    expect(sheet.getCell("B3").text).toBe("b");
    expect(sheet.model.merges).toEqual([]);
    expect(sheet.rowCount).toBe(3);
  });
});
