import { exportToExcel } from "../../shared/lib/export";
import { getOrganizationDisplayName, getOrganizationTypeLabel } from "../organization/model";
import { getPersonalFormUrl, type PersonalLink } from "./api";

export function exportPersonalLinksXlsx(formId: string, title: string, links: PersonalLink[]) {
  return exportToExcel(links.map(organization => ({
    "Тип ОУ": getOrganizationTypeLabel(organization.organization_type, true),
    "Организация": getOrganizationDisplayName(organization),
    "Номер": organization.number ?? "",
    "Email": organization.email,
    "Персональная ссылка": getPersonalFormUrl(formId, organization.token),
  })), `персональные-ссылки-${title}`, "Персональные ссылки");
}
