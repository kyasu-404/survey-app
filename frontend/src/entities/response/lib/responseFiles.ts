import type { SurveySchema } from "../../survey/types";

export function hasArchiveFileQuestions(schema: SurveySchema) {
  let visited = 0;
  const visit = (value: unknown, depth: number): boolean => {
    if (!value || typeof value !== "object" || ++visited > 10_000 || depth > 32) return false;
    const item = value as Record<string, unknown>;
    const name = typeof item.valueName === "string" && item.valueName ? item.valueName : item.name;
    if (item.type === "file" && typeof name === "string") return true;
    for (const key of ["pages", "elements", "templateElements"]) {
      const children = item[key];
      if (Array.isArray(children) && children.some(child => visit(child, depth + 1))) return true;
    }
    if (item.type !== "matrixdynamic" && item.type !== "matrixdropdown") return false;
    if (Array.isArray(item.columns) && item.columns.some(column =>
      column && typeof column === "object" && visit({ ...column, type: column.cellType ?? item.cellType }, depth + 1),
    )) return true;
    return Array.isArray(item.detailElements) && item.detailElements.some(child => visit(child, depth + 1));
  };
  return visit(schema, 0);
}
