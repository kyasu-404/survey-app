import { loadExcelJS } from "../../shared/lib/exceljs";
import { createExcelWorkbook } from "../../shared/lib/export";
import {
  getOrganizationTypeLabel,
  isOrganizationType,
  normalizeOrganizationInput,
  validateOrganizationInput,
} from "./model";
import type { EducationOrganizationInput, OrganizationType } from "./types";

const TYPE_ALIASES = new Map<string, OrganizationType>([
  ["школа", "school"],
  ["школы", "school"],
  ["school", "school"],
  ["сад", "kindergarten"],
  ["сады", "kindergarten"],
  ["детский сад", "kindergarten"],
  ["детские сады", "kindergarten"],
  ["kindergarten", "kindergarten"],
  ["одо", "odo"],
  ["odo", "odo"],
  ["удод", "udod"],
  ["удоды", "udod"],
  ["udod", "udod"],
]);

function normalizeHeader(value: string) {
  return value.trim().toLocaleLowerCase("ru-RU").replace(/ё/g, "е").replace(/\s+/g, " ");
}

function parseOrganizationType(value: string) {
  const normalized = normalizeHeader(value);
  return TYPE_ALIASES.get(normalized) ?? (isOrganizationType(normalized) ? normalized : null);
}

async function parseWorkbook(bytes: ArrayBuffer): Promise<EducationOrganizationInput[]> {
  const { Workbook } = await loadExcelJS();
  const workbook = new Workbook();
  await workbook.xlsx.load(bytes);
  const worksheet = workbook.worksheets[0];
  if (!worksheet) {
    throw new Error("В XLSX нет листов с данными");
  }

  const headers = new Map<string, number>();
  worksheet.getRow(1).eachCell((cell, column) => {
    headers.set(normalizeHeader(cell.text), column);
  });
  const typeColumn = headers.get("тип оу") ?? headers.get("тип");
  const numberColumn = headers.get("номер");
  const aliasColumn = headers.get("алиас") ?? headers.get("алиасы");
  const emailColumn = headers.get("email") ?? headers.get("e-mail");
  if (!typeColumn || !numberColumn || !aliasColumn || !emailColumn) {
    throw new Error("Ожидаются столбцы: Тип ОУ, Номер, Алиасы, Email");
  }

  const inputs: EducationOrganizationInput[] = [];
  worksheet.eachRow({ includeEmpty: false }, (row, rowIndex) => {
    if (rowIndex < 2) return;
    const typeText = row.getCell(typeColumn).text.trim();
    const number = row.getCell(numberColumn).text.trim();
    const alias = row.getCell(aliasColumn).text.trim();
    const email = row.getCell(emailColumn).text.trim();
    if (!typeText && !number && !alias && !email) {
      return;
    }

    const organizationType = parseOrganizationType(typeText);
    if (!organizationType) {
      throw new Error(`Строка ${rowIndex}: неизвестный тип ОУ «${typeText}»`);
    }
    if (organizationType === "udod" && number) {
      throw new Error(`Строка ${rowIndex}: для УДОД номер задавать нельзя`);
    }

    const input = normalizeOrganizationInput({
      organization_type: organizationType,
      number: number || null,
      alias,
      email,
    });
    const validationError = validateOrganizationInput(input);
    if (validationError) {
      throw new Error(`Строка ${rowIndex}: ${validationError}`);
    }
    inputs.push(input);
    if (inputs.length > 5000) {
      throw new Error("За один раз можно импортировать не более 5000 организаций");
    }
  });

  if (inputs.length === 0) {
    throw new Error("В XLSX нет организаций для импорта");
  }
  return inputs;
}

async function encodeWorkbook(organizations: EducationOrganizationInput[]): Promise<ArrayBuffer> {
  const workbook = await createExcelWorkbook(
    organizations.map((organization) => ({
      "Тип ОУ": getOrganizationTypeLabel(organization.organization_type, true),
      Номер: organization.number ?? "",
      Алиасы: organization.alias,
      Email: organization.email,
    })),
    "Организации",
  );
  const buffer: unknown = await workbook.xlsx.writeBuffer();
  if (ArrayBuffer.isView(buffer)) {
    const { buffer: backing, byteOffset, byteLength } = buffer;
    if (backing instanceof ArrayBuffer && byteOffset === 0 && byteLength === backing.byteLength) {
      return backing;
    }
    return new Uint8Array(backing, byteOffset, byteLength).slice().buffer;
  }
  if (Object.prototype.toString.call(buffer) === "[object ArrayBuffer]") return buffer as ArrayBuffer;
  throw new Error("Не удалось сформировать XLSX");
}

export type OrganizationXlsxRequest =
  | { operation: "parse"; bytes: ArrayBuffer }
  | { operation: "export"; organizations: EducationOrganizationInput[] };

export type OrganizationXlsxResult =
  | { ok: true; operation: "parse"; rows: EducationOrganizationInput[] }
  | { ok: true; operation: "export"; bytes: ArrayBuffer }
  | { ok: false; message: string };

export async function runOrganizationXlsxTask(request: OrganizationXlsxRequest): Promise<OrganizationXlsxResult> {
  try {
    if (request.operation === "parse") {
      return { ok: true, operation: "parse", rows: await parseWorkbook(request.bytes) };
    }
    return { ok: true, operation: "export", bytes: await encodeWorkbook(request.organizations) };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "Не удалось обработать XLSX",
    };
  }
}
