export type TableColumnGroup = {
  key: string;
  header: string;
};

export type TableColumn = TableColumnGroup & {
  isDate?: boolean;
  kind?: "page" | "section";
  page?: TableColumnGroup;
  section?: TableColumnGroup;
  sections?: TableColumnGroup[];
  printPage?: TableColumnGroup;
  answerType?: string;
};

export function getTableValueColumns(columns: TableColumn[]) {
  const populated = new Set<string>();
  columns.forEach(column => [column.page, ...(column.sections ?? [])].forEach(group => {
    if (group && group.key !== column.key) populated.add(group.key);
  }));
  return columns.filter(column => !column.kind || !populated.has(column.key));
}

export function getTableHeaderLevels(columns: TableColumn[], forPrint = false) {
  const levels: Array<{ kind: "page" | "section"; groupOf: (column: TableColumn) => TableColumnGroup | undefined }> = [];
  const pageOf = (column: TableColumn) => forPrint ? column.printPage ?? column.page : column.page;
  if (columns.some(pageOf)) levels.push({ kind: "page", groupOf: pageOf });
  const depth = Math.max(0, ...columns.map(column => column.sections?.length ?? 0));
  for (let index = 0; index < depth; index += 1) {
    levels.push({ kind: "section", groupOf: column => column.sections?.[index] });
  }
  return levels;
}

