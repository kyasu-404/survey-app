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

export async function exportToExcel(data: Array<Record<string, unknown>>, fileName = "responses") {
  if (!data.length) return;

  const ExcelJS = await import("exceljs");
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet("Ответы");
  const headers = getHeaders(data);

  worksheet.columns = headers.map((header) => ({
    header,
    key: header,
  }));

  sanitizeRows(data).forEach((row) => {
    worksheet.addRow(row);
  });

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: XLSX_MIME_TYPE });
  downloadBlob(blob, `${sanitizeFileName(fileName)}.xlsx`);
}
