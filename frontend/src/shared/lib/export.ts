import type { ResponsesTableColumn } from "./responsesExport";

const XLSX_MIME_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const DANGEROUS_SPREADSHEET_PREFIXES = new Set(["=", "+", "-", "@"]);

export function neutralizeSpreadsheetFormula(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }

  const trimmed = value.trimStart();
  if (!trimmed) {
    return value;
  }

  return DANGEROUS_SPREADSHEET_PREFIXES.has(trimmed[0]) ? `\t${value}` : value;
}

function sanitizeRows(data: Array<Record<string, unknown>>) {
  return data.map((row) =>
    Object.fromEntries(
      Object.entries(row).map(([key, value]) => [key, neutralizeSpreadsheetFormula(value)]),
    ),
  );
}

function getHeaders(data: Array<Record<string, unknown>>) {
  return Array.from(new Set(data.flatMap((row) => Object.keys(row))));
}

function sanitizeFileName(fileName: string) {
  const trimmed = fileName.trim() || "responses";
  return trimmed.replace(/[\\/:*?"<>|]/g, "-");
}

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");

  anchor.href = url;
  anchor.download = fileName;
  anchor.click();

  URL.revokeObjectURL(url);
}

// Non-empty groups use a title above their first question instead of a separator column.
// Keep a placeholder for empty groups so their titles are not lost.
function getExcelColumns(columns: ResponsesTableColumn[]) {
  const populatedGroups = new Set<string>();
  columns.forEach((column) => {
    [column.page, column.section].forEach((group) => {
      if (group && group.key !== column.key) populatedGroups.add(group.key);
    });
  });
  return columns.filter((column) => !column.kind || !populatedGroups.has(column.key));
}

export async function createExcelWorkbook(
  data: Array<Record<string, unknown>>,
  worksheetName = "Ответы",
  columns?: ResponsesTableColumn[],
) {
  const ExcelJS = await import("exceljs");
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet(worksheetName.slice(0, 31) || "Данные");
  const exportColumns = getExcelColumns(columns ?? getHeaders(data).map((header) => ({ key: header, header })));
  const groupLevels = (["page", "section"] as const).filter((level) => exportColumns.some((column) => column[level]));
  worksheet.columns = exportColumns.map(({ key }) => ({ key }));

  groupLevels.forEach((level) => {
    const row = worksheet.addRow(exportColumns.map(() => ""));
    row.height = 32;
    for (let start = 0; start < exportColumns.length;) {
      const group = exportColumns[start][level];
      if (!group) { start += 1; continue; }
      let end = start + 1;
      while (end < exportColumns.length && exportColumns[end][level]?.key === group.key) end += 1;
      const cell = row.getCell(start + 1);
      cell.value = String(neutralizeSpreadsheetFormula(group.header));
      cell.font = { bold: true, color: { argb: level === "page" ? "FF1E40AF" : "FF1F2937" } };
      for (let index = start; index < end; index += 1) {
        row.getCell(index + 1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: level === "page" ? "FFDBEAFE" : "FFF1F5F9" } };
      }
      cell.alignment = { horizontal: "left", vertical: "middle", wrapText: true };
      row.height = Math.max(row.height ?? 32, group.header.split("\n").reduce((lines, text) => lines + Math.max(1, Math.ceil(text.length / 26)), 0) * 16);
      start = end;
    }
  });

  const headerRow = worksheet.addRow(exportColumns.map((column) => column.kind ? "" : neutralizeSpreadsheetFormula(column.header)));
  if (groupLevels.length) {
    headerRow.font = { bold: true };
    headerRow.alignment = { vertical: "middle", wrapText: true };
    headerRow.height = 45;
    worksheet.columns.forEach((column) => { column.width = 28; });
    worksheet.views = [{ state: "frozen", ySplit: headerRow.number }];
    worksheet.pageSetup.printTitlesRow = `1:${headerRow.number}`;
  }

  sanitizeRows(data).forEach((row) => {
    worksheet.addRow(row);
  });

  const gridBorder = { style: "thin" as const, color: { argb: "FF94A3B8" } };
  const groupBorder = { style: "medium" as const, color: { argb: "FF475569" } };
  worksheet.eachRow((row) => {
    exportColumns.forEach((column, index) => {
      const previous = exportColumns[index - 1];
      const isGroupBoundary = column.page?.key !== previous?.page?.key || column.section?.key !== previous?.section?.key;
      row.getCell(index + 1).border = {
        top: gridBorder, bottom: gridBorder, right: gridBorder,
        left: isGroupBoundary ? groupBorder : gridBorder,
      };
    });
  });

  return workbook;
}

export async function exportToExcel(
  data: Array<Record<string, unknown>>,
  fileName = "responses",
  worksheetName = "Ответы",
  columns?: ResponsesTableColumn[],
) {
  if (!data.length) return;
  const workbook = await createExcelWorkbook(data, worksheetName, columns);

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: XLSX_MIME_TYPE });
  downloadBlob(blob, `${sanitizeFileName(fileName)}.xlsx`);
}
