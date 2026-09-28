import type { SurveyResponse } from "../../entities/response/types";
import type { SurveyQuestion, SurveySchema } from "../../entities/survey/types";
import { answerCommentKey, hasAnswerComment, formatSimpleAnswer, formatMatrixAnswer, readableValue, COMPLEX_ANSWER_TYPES } from "./answerValue";
import { getSignatureImage, SIGNATURE_UNAVAILABLE } from "./signatureImage";
import { RESPONSES_HTML_LAYOUT_CSS } from "./responsesHtmlLayout";
import { sectionSiblings } from "./surveyHierarchy";

export type ResponsesTableRow = {
  [key: string]: string;
};

export type ResponsesColumnGroup = {
  key: string;
  header: string;
};

export type ResponsesTableColumn = ResponsesColumnGroup & {
  isDate?: boolean;
  kind?: "page" | "section";
  page?: ResponsesColumnGroup;
  section?: ResponsesColumnGroup;
  sections?: ResponsesColumnGroup[];
  printPage?: ResponsesColumnGroup;
  answerType?: string;
};

export type ResponsesTable = {
  columns: ResponsesTableColumn[];
  rows: ResponsesTableRow[];
};

type ResponsesHtmlInput = ResponsesTable & {
  title: string;
  generatedAt?: Date;
};

export const RESPONSE_DATE_KEY = "response-date";
const RESPONSE_DATE_HEADER = "Дата ответа";
const NON_ANSWER_TYPES = new Set(["panel", "html", "image"]);
const MAX_EXPORT_VALUE_DEPTH = 32;
const MAX_EXPORT_VALUE_NODES = 10_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function getQuestionMeta(schema: SurveySchema) {
  const questionMap = new Map<string, SurveyQuestion>();
  const columns: ResponsesTableColumn[] = [];
  const seenNames = new Set<string>();
  let visited = 0;

  const visit = (elements: SurveyQuestion[], parents: Pick<ResponsesTableColumn, "page" | "printPage" | "sections">, scope: string, depth: number) => {
    if (depth > MAX_EXPORT_VALUE_DEPTH) return;
    for (const { question, sections, group, path } of sectionSiblings(elements, parents.sections, scope)) {
      if (++visited > MAX_EXPORT_VALUE_NODES) return;
      const groups = { ...parents, sections };
      const name = question.valueName || question.name;
      const section = sections[sections.length - 1];
      if (group) {
        columns.push({ ...group, ...groups, section: group, kind: "section" });
        if (question.name) seenNames.add(question.name);
        if (name) seenNames.add(name);
        if (question.type === "panel" && Array.isArray(question.elements)) visit(question.elements, groups, path, depth + 1);
        continue;
      }
      if (!name || NON_ANSWER_TYPES.has(question.type)) continue;
      const header = question.title?.trim() || question.name;
      if (!seenNames.has(name)) {
        columns.push({ key: `answer:${name}`, header, ...groups, section, answerType: question.type });
        seenNames.add(name);
      }
      questionMap.set(name, question);
      if (hasAnswerComment(question)) seenNames.add(answerCommentKey(question, schema.commentSuffix));
    }
  };

  const pages = Array.isArray(schema.pages) ? schema.pages : [];
  pages.forEach((page, index) => {
    const header = page?.title?.trim();
    const pageGroup = header ? { key: `page:${index}`, header } : undefined;
    const printPage = header || pages.length > 1 ? { key: `page:${index}`, header: header || `Страница ${index + 1}` } : undefined;
    if (pageGroup) columns.push({ ...pageGroup, kind: "page", page: pageGroup, printPage });
    const elements = Array.isArray(page?.elements) ? page.elements : [];
    visit(elements, { page: pageGroup, printPage }, String(index), 0);
  });

  return { columns, seenNames, questionMap };
}

function isSafeExportValue(value: unknown) {
  if (!isRecord(value)) {
    return true;
  }

  const pending: Array<{ value: Record<string, unknown> | unknown[]; depth: number }> = [
    { value: value as Record<string, unknown> | unknown[], depth: 0 },
  ];
  const visited = new WeakSet<object>();
  let visitedNodes = 0;

  while (pending.length > 0) {
    const current = pending.pop();
    if (!current) {
      continue;
    }

    if (visited.has(current.value)) {
      return false;
    }
    visited.add(current.value);

    visitedNodes += 1;
    if (current.depth > MAX_EXPORT_VALUE_DEPTH || visitedNodes > MAX_EXPORT_VALUE_NODES) {
      return false;
    }

    Object.values(current.value).forEach((nested) => {
      if (isRecord(nested)) {
        pending.push({
          value: nested as Record<string, unknown> | unknown[],
          depth: current.depth + 1,
        });
      }
    });
  }

  return true;
}

function formatAnswerValue(question: SurveyQuestion | undefined, value: unknown, organizationLabels?: Map<string, string>, siblings: Record<string, unknown> = {}, suffix = "-Comment", depth = 0): string {
  if (depth > MAX_EXPORT_VALUE_DEPTH || !isSafeExportValue(value)) return "[Значение превышает допустимую сложность]";
  if (!question) return formatObjectValue(value);
  if (question.type === "paneldynamic" && Array.isArray(value)) return formatDynamicPanel(question, value, organizationLabels, suffix, depth);
  if (["matrix", "matrixdropdown", "matrixdynamic", "multipletext"].includes(question.type)) return formatMatrixAnswer(question, value, suffix, organizationLabels);
  return formatSimpleAnswer(question, value, siblings, suffix, organizationLabels);
}

function formatDynamicPanel(question: SurveyQuestion, values: unknown[], organizationLabels: Map<string, string> | undefined, suffix: string, depth: number): string {
  if (depth > MAX_EXPORT_VALUE_DEPTH || !isSafeExportValue(values)) return "[Значение превышает допустимую сложность]";
  const meta = getQuestionMeta({ pages: [{ elements: question.templateElements ?? [] }], commentSuffix: suffix });
  return values.map((value, index) => {
    if (!isRecord(value) || Array.isArray(value)) return `Запись ${index + 1}: ${formatObjectValue(value) || "—"}`;
    const lines = meta.columns.filter(column => !column.kind).map(column => {
      const name = column.key.slice("answer:".length);
      const raw = Object.prototype.hasOwnProperty.call(value, name) ? value[name] : undefined;
      const answer = column.answerType === "signaturepad" && raw
        ? (getSignatureImage(String(raw)) ? "Подпись (см. просмотр ответа)" : SIGNATURE_UNAVAILABLE)
        : formatAnswerValue(meta.questionMap.get(name), raw, organizationLabels, value, suffix, depth + 1);
      const label = [...(column.sections ?? []).map(group => group.header), column.header].join(" / ");
      return answer.includes("\n") ? `${label}:\n  ${answer.replace(/\n/g, "\n  ")}` : `${label}: ${answer || "—"}`;
    });
    // Keep data from removed template questions instead of silently dropping it.
    Object.entries(value).forEach(([name, answer]) => {
      if (!meta.seenNames.has(name)) lines.push(`${name}: ${formatObjectValue(answer) || "—"}`);
    });
    return [`Запись ${index + 1}`, ...lines].join("\n");
  }).join("\n\n");
}

function formatObjectValue(value: unknown): string {
  if (!isRecord(value)) return String(value ?? "");
  if (!isSafeExportValue(value)) return "[Значение превышает допустимую сложность]";
  try {
    return readableValue(value);
  } catch {
    return "[Не удалось отобразить значение]";
  }
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function sanitizeFileName(fileName: string) {
  const trimmed = fileName.trim() || "responses";
  return trimmed.replace(/[\\/:*?"<>|]/g, "-");
}

function formatResponseDate(value: string) {
  const formatter = new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  const parts = formatter.formatToParts(new Date(value));
  const getPart = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  const datePart = [getPart("day"), getPart("month"), getPart("year")].filter(Boolean).join(".");
  const timePart = [getPart("hour"), getPart("minute")].filter(Boolean).join(":");

  return timePart ? `${datePart}, ${timePart}` : datePart;
}

function getDateCellParts(value: string) {
  const [datePart, timePart] = value.split(",").map((part) => part.trim());

  return {
    datePart: datePart || value,
    timePart: timePart || "",
  };
}

export function getResponseColumnClassName(column: ResponsesTableColumn) {
  if (column.kind) return `responses-table-${column.kind}-column`;
  if (COMPLEX_ANSWER_TYPES.has(column.answerType ?? "")) return "responses-table-multiline-column";
  return column.isDate ? "responses-table-date-column" : "";
}

function renderResponseHtmlCell(column: ResponsesTableColumn, value: string) {
  if (column.answerType === "signaturepad" && value) {
    const image = getSignatureImage(value);
    return image ? `<img class="response-signature-image" src="${image.dataUrl}" alt="Подпись" width="${image.width}" height="${image.height}">` : SIGNATURE_UNAVAILABLE;
  }
  if (!column.isDate) {
    return escapeHtml(value);
  }

  const { datePart, timePart } = getDateCellParts(value);

  return `<span class="responses-table-date-cell"><span class="responses-table-date-line">${escapeHtml(
    datePart,
  )}</span>${timePart ? `<span class="responses-table-date-line">${escapeHtml(timePart)}</span>` : ""}</span>`;
}

export function formatResponsesForTable(
  responses: SurveyResponse[],
  schema: SurveySchema,
  organizationLabels?: Map<string, string>,
): ResponsesTable {
  const { columns: schemaColumns, seenNames, questionMap } = getQuestionMeta(schema);
  // Include legacy/extra answer keys once, across all responses, after schema columns.
  const columns: ResponsesTableColumn[] = [
    { key: RESPONSE_DATE_KEY, header: RESPONSE_DATE_HEADER, isDate: true },
    ...schemaColumns,
  ];
  responses.forEach((response) => Object.keys(response.data).forEach((name) => {
    if (seenNames.has(name)) return;
    columns.push({ key: `answer:${name}`, header: name });
    seenNames.add(name);
  }));

  const rows = responses.map((response) => {
    const base: ResponsesTableRow = {
      [RESPONSE_DATE_KEY]: formatResponseDate(response.created_at),
    };
    const answerEntries = new Map(Object.entries(response.data));

    columns.forEach((column) => {
      if (column.isDate) return;
      const name = column.key.slice("answer:".length);
      base[column.key] = column.kind ? "" : formatAnswerValue(questionMap.get(name), answerEntries.get(name), organizationLabels, response.data, schema.commentSuffix);
    });

    return base;
  });

  return { columns, rows };
}

function renderHtmlTable(columns: ResponsesTableColumn[], rows: ResponsesTableRow[], groupHeaders = "") {
  const colgroup = groupHeaders ? `<colgroup>${columns.map(column => `<col${column.isDate ? ' class="responses-table-date-column"' : ""}>`).join("")}</colgroup>` : "";
  return `<div class="responses-table-wrap"><table>${colgroup}<thead>${groupHeaders}<tr>${columns
        .map((column) => {
          const className = getResponseColumnClassName(column);
          return `<th${className ? ` class="${className}"` : ""}>${escapeHtml(groupHeaders && column.kind ? "" : column.header)}</th>`;
        })
        .join("")}</tr></thead><tbody>${rows
        .map(
          (row) =>
            `<tr>${columns
              .map((column) => {
                const className = getResponseColumnClassName(column);
                return `<td${className ? ` class="${className}"` : ""}>${renderResponseHtmlCell(
                  column,
                  row[column.key] ?? "",
                )}</td>`;
              })
              .join("")}</tr>`,
        )
        .join("")}</tbody></table></div>`;
}

// Non-empty groups become header rows in XLSX and print, leaving room for answers.
// Retain a placeholder for empty groups so their titles are not lost.
export function getResponseAnswerColumns(columns: ResponsesTableColumn[]) {
  const populated = new Set<string>();
  columns.forEach(column => [column.page, ...(column.sections ?? [])].forEach(group => {
    if (group && group.key !== column.key) populated.add(group.key);
  }));
  return columns.filter(column => !column.kind || !populated.has(column.key));
}

export function getResponseHeaderLevels(columns: ResponsesTableColumn[], forPrint = false) {
  const levels: Array<{ kind: "page" | "section"; groupOf: (column: ResponsesTableColumn) => ResponsesColumnGroup | undefined }> = [];
  const pageOf = (column: ResponsesTableColumn) => forPrint ? column.printPage ?? column.page : column.page;
  if (columns.some(pageOf)) levels.push({ kind: "page", groupOf: pageOf });
  const depth = Math.max(0, ...columns.map(column => column.sections?.length ?? 0));
  for (let index = 0; index < depth; index += 1) {
    levels.push({ kind: "section", groupOf: column => column.sections?.[index] });
  }
  return levels;
}

export const MAX_PRINT_ANSWER_COLUMNS = 8;

function splitColumnGroups(columns: ResponsesTableColumn[], groupKey: (column: ResponsesTableColumn) => string | undefined) {
  const groups: ResponsesTableColumn[][] = [];
  columns.forEach(column => {
    const previous = groups[groups.length - 1];
    if (!previous || groupKey(previous[0]) !== groupKey(column)) groups.push([column]);
    else previous.push(column);
  });
  return groups;
}

export function getResponsesPrintBlocks(columns: ResponsesTableColumn[]): ResponsesTableColumn[][] {
  const dates = columns.filter(column => column.isDate);
  const answers = getResponseAnswerColumns(columns).filter(column => !column.isDate);
  if (answers.length <= MAX_PRINT_ANSWER_COLUMNS) return [[...dates, ...answers]];
  const pages = splitColumnGroups(answers, column => (column.printPage ?? column.page)?.key);
  return pages.flatMap(page => {
    const sections = page.length <= MAX_PRINT_ANSWER_COLUMNS ? [page] : splitColumnGroups(page, column => column.section?.key);
    return sections.flatMap(section => {
      const blocks: ResponsesTableColumn[][] = [];
      for (let index = 0; index < section.length; index += MAX_PRINT_ANSWER_COLUMNS) {
        blocks.push([...dates, ...section.slice(index, index + MAX_PRINT_ANSWER_COLUMNS)]);
      }
      return blocks;
    });
  });
}

function renderPrintGroupHeaders(columns: ResponsesTableColumn[]) {
  return getResponseHeaderLevels(columns, true).map(({ kind, groupOf }) => {
    const groups = splitColumnGroups(columns, column => groupOf(column)?.key);
    return `<tr>${groups.map(group => `<th colspan="${group.length}" class="responses-print-${kind}-heading">${escapeHtml(groupOf(group[0])?.header ?? "")}</th>`).join("")}</tr>`;
  }).join("");
}

export function createResponsesHtmlReport({ title, columns, rows, generatedAt = new Date() }: ResponsesHtmlInput) {
  const generatedAtLabel = formatResponseDate(generatedAt.toISOString());
  const blocks = getResponsesPrintBlocks(columns);
  const body = rows.length
    ? `<div class="responses-report-screen">${renderHtmlTable(columns, rows)}</div><div class="responses-report-print">${blocks.map((block, index) =>
      `<section class="responses-print-block">${blocks.length > 1 ? `<h2>Таблица ${index + 1} из ${blocks.length}</h2>` : ""}${renderHtmlTable(block, rows, renderPrintGroupHeaders(block))}</section>`,
    ).join("")}</div>`
    : `<section class="empty-state"><h2>Ответов пока нет</h2><p>Новые ответы появятся здесь после отправки формы.</p></section>`;

  return `<article class="responses-html-report"><header class="report-header"><p class="eyebrow">Ответы формы</p><h1>${escapeHtml(
    title,
  )}</h1><dl class="report-meta"><div><dt>Всего ответов</dt><dd>${rows.length}</dd></div><div><dt>Сформировано</dt><dd>${escapeHtml(
    generatedAtLabel,
  )}</dd></div></dl></header>${body}</article>`;
}

export function createResponsesHtmlDocument(input: ResponsesHtmlInput) {
  const report = createResponsesHtmlReport(input);
  const title = escapeHtml(input.title);

  return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Ответы - ${title}</title>
  <style>
    :root {
      color: #171717;
      background: #f6f7f9;
      font-family: Arial, Helvetica, sans-serif;
    }

    * {
      box-sizing: border-box;
    }

    body {
      margin: 0;
      padding: 24px;
      background: #f6f7f9;
      color: #171717;
    }

    .responses-html-report {
      width: min(1120px, 100%);
      margin: 0 auto;
      padding: 28px;
      border: 1px solid #d7dde8;
      border-radius: 8px;
      background: #ffffff;
      font-size: 13px;
    }

    .report-header {
      display: grid;
      gap: 18px;
      margin-bottom: 24px;
    }

    .eyebrow {
      margin: 0;
      color: #626a78;
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0;
      text-transform: uppercase;
    }

    h1 {
      margin: 0;
      font-size: 28px;
      line-height: 1.2;
      overflow-wrap: anywhere;
    }

    .report-meta {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 10px;
      margin: 0;
    }

    .report-meta div {
      padding: 12px;
      border: 1px solid #e1e5ec;
      border-radius: 8px;
      background: #f9fafb;
    }

    dt {
      margin: 0 0 6px;
      color: #626a78;
      font-size: 11px;
    }

    dd {
      margin: 0;
      font-weight: 700;
    }

    .responses-table-wrap {
      width: 100%;
      overflow-x: auto;
      border: 1px solid #dfe4ec;
      border-radius: 8px;
    }

    table {
      width: 100%;
      min-width: 640px;
      border-collapse: collapse;
      font-size: 13px;
    }

    .responses-table-date-column {
      width: 12ch;
      min-width: 12ch;
      max-width: none;
      white-space: normal;
    }

    td.responses-table-date-column {
      white-space: nowrap;
      overflow-wrap: normal;
    }

    .responses-table-date-cell {
      display: grid;
      width: max-content;
      min-width: 10ch;
      line-height: 1.25;
    }

    .responses-table-date-line {
      display: block;
    }

    th,
    td {
      padding: 12px;
      border: 1px solid #d8dee8;
      text-align: left;
      vertical-align: top;
      white-space: normal;
      overflow-wrap: anywhere;
      word-break: break-word;
      max-width: min(28rem, 40vw);
    }

    th {
      background: #f1f3f7;
      font-size: 11px;
      text-transform: uppercase;
    }

    th.responses-table-page-column,
    td.responses-table-page-column {
      background: #dbeafe;
      color: #1e40af;
    }

    th.responses-table-section-column {
      font-weight: 800;
      border-left: 3px solid #64748b;
      background: #f1f5f9;
    }

    td.responses-table-section-column {
      border-left: 3px solid #64748b;
      background: #f8fafc;
    }

    tr:last-child td {
      border-bottom: 1px solid #d8dee8;
    }

    .empty-state {
      padding: 22px;
      border: 1px dashed #cbd3df;
      border-radius: 8px;
      background: #fbfcfd;
    }

    .empty-state h2,
    .empty-state p {
      margin: 0;
    }

    .empty-state p {
      margin-top: 8px;
      color: #626a78;
    }

    @media (max-width: 720px) {
      body {
        padding: 12px;
      }

      .responses-html-report {
        padding: 16px;
      }

      h1 {
        font-size: 22px;
      }
    }

    @media print {
      body {
        padding: 0;
        background: #ffffff;
      }

      .responses-html-report {
        width: 100%;
        border: none;
        padding: 0;
      }
    }
    ${RESPONSES_HTML_LAYOUT_CSS}
  </style>
</head>
<body>
  ${report}
</body>
</html>`;
}

export function downloadHtmlDocument(html: string, fileName: string) {
  if (typeof document === "undefined") {
    return;
  }

  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${sanitizeFileName(fileName)}.html`;
  link.rel = "noopener";

  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
