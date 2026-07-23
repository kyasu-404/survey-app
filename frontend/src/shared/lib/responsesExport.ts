import type { SurveyResponse } from "../../entities/response/types";
import type { SurveyPageSchema, SurveyQuestion, SurveySchema } from "../../entities/survey/types";

export type ResponsesTableRow = {
  [key: string]: string;
};

type ResponsesHtmlInput = {
  title: string;
  rows: ResponsesTableRow[];
  generatedAt?: Date;
};

const RESPONSE_DATE_HEADER = "Дата ответа";
const NESTED_QUESTION_KEYS = ["elements", "items", "rows", "columns", "panels", "templateElements"] as const;
const MAX_EXPORT_VALUE_DEPTH = 32;
const MAX_EXPORT_VALUE_NODES = 10_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function visitSurveyQuestion(value: unknown, visitor: (question: SurveyQuestion) => void) {
  const pending: Array<{ value: unknown; depth: number }> = [{ value, depth: 0 }];
  let visitedNodes = 0;

  while (pending.length > 0) {
    const current = pending.pop();
    if (!current || !isRecord(current.value)) {
      continue;
    }

    visitedNodes += 1;
    if (current.depth > MAX_EXPORT_VALUE_DEPTH || visitedNodes > MAX_EXPORT_VALUE_NODES) {
      return;
    }

    if (typeof current.value.name === "string") {
      visitor(current.value as SurveyQuestion);
    }

    const currentValue = current.value;
    NESTED_QUESTION_KEYS.forEach((key) => {
      const nested = currentValue[key];
      if (Array.isArray(nested)) {
        for (let index = nested.length - 1; index >= 0; index -= 1) {
          pending.push({ value: nested[index], depth: current.depth + 1 });
        }
      }
    });
  }
}

function getQuestionMeta(schema: SurveySchema) {
  const choiceMap = new Map<string, Map<string, string>>();
  const titleMap = new Map<string, string>();
  const orderedNames: string[] = [];
  const seenNames = new Set<string>();

  const addQuestionMeta = (question: SurveyQuestion) => {
    if (question.name) {
      if (!seenNames.has(question.name)) {
        orderedNames.push(question.name);
        seenNames.add(question.name);
      }

      titleMap.set(question.name, question.title ?? question.name);
    }

    if (!Array.isArray(question.choices) || !question.name) {
      return;
    }

    const questionChoiceMap = new Map<string, string>();
    question.choices.forEach((choice) => {
      if (typeof choice === "string") {
        questionChoiceMap.set(choice, choice);
        return;
      }

      const value = String(choice.value ?? choice.text ?? "");
      const text = String(choice.text ?? choice.value ?? "");
      if (value) {
        questionChoiceMap.set(value, text);
      }
    });

    if (questionChoiceMap.size > 0) {
      choiceMap.set(question.name, questionChoiceMap);
    }
  };

  const pages = Array.isArray(schema.pages) ? schema.pages : [];
  pages.forEach((page: SurveyPageSchema) => {
    const elements = Array.isArray(page?.elements) ? page.elements : [];
    elements.forEach((element) => visitSurveyQuestion(element, addQuestionMeta));
  });

  return { choiceMap, orderedNames, titleMap };
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

function formatAnswerValue(questionName: string, value: unknown, choiceMap: Map<string, Map<string, string>>) {
  const questionChoices = choiceMap.get(questionName);

  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (typeof item === "string" && questionChoices?.has(item)) {
          return questionChoices.get(item) ?? item;
        }

        if (item && typeof item === "object" && "name" in item && typeof item.name === "string") {
          return item.name;
        }

        return String(item ?? "");
      })
      .filter(Boolean)
      .join(", ");
  }

  if (typeof value === "string" && questionChoices?.has(value)) {
    return questionChoices.get(value) ?? value;
  }

  if (value === null || typeof value === "undefined") {
    return "";
  }

  if (typeof value === "object") {
    if ("name" in value && typeof value.name === "string") {
      return value.name;
    }

    if (!isSafeExportValue(value)) {
      return "[Значение превышает допустимую сложность]";
    }

    try {
      return JSON.stringify(value);
    } catch {
      return "[Не удалось отобразить значение]";
    }
  }

  return String(value);
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

function getResponseColumnClassName(header: string) {
  return header === RESPONSE_DATE_HEADER ? "responses-table-date-column" : "";
}

function renderResponseHtmlCell(header: string, value: string) {
  if (header !== RESPONSE_DATE_HEADER) {
    return escapeHtml(value);
  }

  const { datePart, timePart } = getDateCellParts(value);

  return `<span class="responses-table-date-cell"><span class="responses-table-date-line">${escapeHtml(
    datePart,
  )}</span>${timePart ? `<span class="responses-table-date-line">${escapeHtml(timePart)}</span>` : ""}</span>`;
}

export function formatResponsesForTable(responses: SurveyResponse[], schema: SurveySchema): ResponsesTableRow[] {
  const { choiceMap, orderedNames, titleMap } = getQuestionMeta(schema);

  return responses.map((response) => {
    const base: ResponsesTableRow = {
      [RESPONSE_DATE_HEADER]: formatResponseDate(response.created_at),
    };
    const answerEntries = new Map(Object.entries(response.data));

    orderedNames.forEach((key) => {
      const hasAnswer = answerEntries.has(key);
      base[titleMap.get(key) ?? key] = hasAnswer ? formatAnswerValue(key, answerEntries.get(key), choiceMap) : "";
      answerEntries.delete(key);
    });

    answerEntries.forEach((value, key) => {
      base[titleMap.get(key) ?? key] = formatAnswerValue(key, value, choiceMap);
    });

    return base;
  });
}

export function getResponseTableHeaders(rows: ResponsesTableRow[]) {
  const headers: string[] = [];

  rows.forEach((row) => {
    Object.keys(row).forEach((header) => {
      if (!headers.includes(header)) {
        headers.push(header);
      }
    });
  });

  return headers;
}

export function createResponsesHtmlReport({ title, rows, generatedAt = new Date() }: ResponsesHtmlInput) {
  const headers = getResponseTableHeaders(rows);
  const generatedAtLabel = formatResponseDate(generatedAt.toISOString());

  const body = rows.length
    ? `<div class="responses-table-wrap"><table><thead><tr>${headers
        .map((header) => {
          const className = getResponseColumnClassName(header);
          return `<th${className ? ` class="${className}"` : ""}>${escapeHtml(header)}</th>`;
        })
        .join("")}</tr></thead><tbody>${rows
        .map(
          (row) =>
            `<tr>${headers
              .map((header) => {
                const className = getResponseColumnClassName(header);
                return `<td${className ? ` class="${className}"` : ""}>${renderResponseHtmlCell(
                  header,
                  row[header] ?? "",
                )}</td>`;
              })
              .join("")}</tr>`,
        )
        .join("")}</tbody></table></div>`
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
