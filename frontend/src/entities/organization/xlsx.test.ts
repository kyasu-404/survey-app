import { Workbook } from "exceljs";
import { describe, expect, it, vi } from "vitest";
import { MAX_ORGANIZATIONS_XLSX_BYTES, parseOrganizationsXlsx } from "./xlsx";

async function spreadsheet(rows: unknown[][]) {
  const workbook = new Workbook();
  const sheet = workbook.addWorksheet("Организации");
  sheet.addRow(["Тип ОУ", "Номер", "Алиасы", "Email"]);
  for (const row of rows) sheet.addRow(row);
  const buffer = await workbook.xlsx.writeBuffer();
  const bytes = Uint8Array.from(new Uint8Array(buffer));
  return { name: "organizations.xlsx", size: bytes.length, arrayBuffer: async () => bytes.buffer } as File;
}

describe("organization XLSX import", () => {
  it("rejects an oversized file before reading its bytes", async () => {
    const arrayBuffer = vi.fn();
    const file = { name: "large.xlsx", size: MAX_ORGANIZATIONS_XLSX_BYTES + 1, arrayBuffer } as unknown as File;
    await expect(parseOrganizationsXlsx(file)).rejects.toThrow("10 МБ");
    expect(arrayBuffer).not.toHaveBeenCalled();
  });

  it("accepts the inclusive size boundary and preserves real XLSX parsing/normalization", async () => {
    const file = await spreadsheet([["Школа", "1", "ГБОУ", "SCHOOL@example.invalid"], ["УДОД", "", "ДДТ", "ddt@example.invalid"]]);
    const bounded = { ...file, size: MAX_ORGANIZATIONS_XLSX_BYTES } as File;
    await expect(parseOrganizationsXlsx(bounded)).resolves.toEqual([
      { organization_type: "school", number: "1", alias: "ГБОУ", email: "school@example.invalid" },
      { organization_type: "udod", number: null, alias: "ДДТ", email: "ddt@example.invalid" },
    ]);
  });

  it("retains the record limit", async () => {
    const file = await spreadsheet(Array.from({ length: 5001 }, (_, i) => ["school", String(i), "School", "school@example.invalid"]));
    await expect(parseOrganizationsXlsx(file)).rejects.toThrow("5000 организаций");
  });
});
