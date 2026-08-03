import { exportToExcel } from "../../shared/lib/export";
import {
  getOrganizationTypeLabel,
  isOrganizationType,
  normalizeOrganizationInput,
  validateOrganizationInput,
} from "./model";
import type { EducationOrganization, EducationOrganizationInput, OrganizationType } from "./types";

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

export async function parseOrganizationsXlsx(file: File): Promise<EducationOrganizationInput[]> {
  const ExcelJS = await import("exceljs");
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await file.arrayBuffer());
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
  for (let rowIndex = 2; rowIndex <= worksheet.rowCount; rowIndex += 1) {
    const row = worksheet.getRow(rowIndex);
    const typeText = row.getCell(typeColumn).text.trim();
    const number = row.getCell(numberColumn).text.trim();
    const alias = row.getCell(aliasColumn).text.trim();
    const email = row.getCell(emailColumn).text.trim();
    if (!typeText && !number && !alias && !email) {
      continue;
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
  }

  if (inputs.length === 0) {
    throw new Error("В XLSX нет организаций для импорта");
  }
  if (inputs.length > 5000) {
    throw new Error("За один раз можно импортировать не более 5000 организаций");
  }
  return inputs;
}

export async function exportOrganizationsXlsx(organizations: EducationOrganization[]) {
  return exportToExcel(
    organizations.map((organization) => ({
      "Тип ОУ": getOrganizationTypeLabel(organization.organization_type, true),
      Номер: organization.number ?? "",
      Алиасы: organization.alias,
      Email: organization.email,
    })),
    "справочник-оу",
    "Организации",
  );
}
