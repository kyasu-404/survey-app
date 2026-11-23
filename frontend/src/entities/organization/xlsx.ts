import type { EducationOrganization, EducationOrganizationInput } from "./types";
import type { OrganizationXlsxRequest, OrganizationXlsxResult } from "./xlsxCodec";

export const MAX_ORGANIZATIONS_XLSX_BYTES = 10 * 1024 * 1024;
const XLSX_MIME_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

async function runTask(request: OrganizationXlsxRequest): Promise<OrganizationXlsxResult> {
  if (typeof window === "undefined" || typeof Worker !== "function") {
    const { runOrganizationXlsxTask } = await import("./xlsxCodec");
    return runOrganizationXlsxTask(request);
  }

  const worker = new Worker(new URL("./xlsx.worker.ts", import.meta.url), { type: "module" });
  try {
    return await new Promise<OrganizationXlsxResult>((resolve, reject) => {
      worker.onmessage = ({ data }: MessageEvent<OrganizationXlsxResult>) => resolve(data);
      worker.onerror = () => reject(new Error("Не удалось запустить обработку XLSX"));
      worker.onmessageerror = () => reject(new Error("Не удалось получить результат обработки XLSX"));
      worker.postMessage(request, request.operation === "parse" ? [request.bytes] : []);
    });
  } finally {
    worker.terminate();
  }
}

export async function parseOrganizationsXlsx(file: File): Promise<EducationOrganizationInput[]> {
  if (file.size > MAX_ORGANIZATIONS_XLSX_BYTES) {
    throw new Error("Размер XLSX не должен превышать 10 МБ");
  }

  const result = await runTask({ operation: "parse", bytes: await file.arrayBuffer() });
  if (!result.ok) throw new Error(result.message);
  if (result.operation !== "parse") throw new Error("Не удалось прочитать XLSX");
  return result.rows;
}

export async function exportOrganizationsXlsx(organizations: EducationOrganization[]): Promise<void> {
  if (!organizations.length) return;
  const rows = organizations.map(({ organization_type, number, alias, email }) => ({
    organization_type, number, alias, email,
  }));
  const result = await runTask({ operation: "export", organizations: rows });
  if (!result.ok) throw new Error(result.message);
  if (result.operation !== "export") throw new Error("Не удалось сформировать XLSX");

  const url = URL.createObjectURL(new Blob([result.bytes], { type: XLSX_MIME_TYPE }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "справочник-оу.xlsx";
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
