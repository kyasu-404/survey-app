import * as XLSX from "xlsx";

export function exportToExcel(data: Array<Record<string, unknown>>, fileName = "responses") {
  if (!data.length) return;

  const worksheet = XLSX.utils.json_to_sheet(data);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Ответы");
  XLSX.writeFile(workbook, `${fileName}.xlsx`);
}
