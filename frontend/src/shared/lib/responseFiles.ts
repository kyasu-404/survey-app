import type { SurveySchema } from "../../entities/survey/types";
import type { SurveyResponse } from "../../entities/response/types";

// null selects each dynamic panel / matrix row, whether stored as an array or map.
type AnswerPath = Array<string | null>;
type FileQuestion = { title: string; path: AnswerPath };
export type ResponseAttachment = { archivePath: string; value: unknown };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function getTitle(value: unknown, fallback: string): string {
  if (typeof value === "string" && value.trim()) return value;
  if (isRecord(value)) return getTitle(value.ru ?? value.default, fallback);
  return fallback;
}

export function getFileQuestions(schema: SurveySchema): FileQuestion[] {
  const result: FileQuestion[] = [];
  let visited = 0;
  const visit = (value: unknown, path: AnswerPath, depth: number) => {
    if (!isRecord(value)) return;
    if (++visited > 10_000 || depth > 32) throw new Error("Слишком сложная структура формы для выгрузки файлов");
    const name = typeof value.valueName === "string" ? value.valueName : value.name;
    const answerPath = typeof name === "string" ? [...path, name] : path;
    if (value.type === "file" && typeof name === "string") {
      result.push({ title: getTitle(value.title, name), path: answerPath });
      return;
    }
    const nestedPath = value.type === "paneldynamic" ? [...answerPath, null] : path;
    for (const key of ["pages", "elements", "templateElements"]) {
      if (Array.isArray(value[key])) value[key].forEach(child => visit(child, nestedPath, depth + 1));
    }
    if (value.type === "matrixdynamic" || value.type === "matrixdropdown") {
      const rowPath = [...answerPath, null];
      if (Array.isArray(value.columns)) {
        value.columns.forEach(column => {
          if (isRecord(column)) visit({ ...column, type: column.cellType ?? value.cellType }, rowPath, depth + 1);
        });
      }
      if (Array.isArray(value.detailElements)) value.detailElements.forEach(child => visit(child, rowPath, depth + 1));
    }
  };
  visit(schema, [], 0);
  return result;
}

function valuesAtPath(data: Record<string, unknown>, path: AnswerPath) {
  let values: unknown[] = [data];
  for (const segment of path) {
    values = values.flatMap(value => {
      if (segment === null) return Array.isArray(value) ? value : isRecord(value) ? Object.values(value) : [];
      return isRecord(value) && Object.prototype.hasOwnProperty.call(value, segment) ? [value[segment]] : [];
    });
  }
  return values.flatMap(value => Array.isArray(value) ? value : [value])
    .filter(value => value !== null && value !== undefined && value !== "");
}

export function safeArchiveName(value: string, fallback: string, maxLength = 100) {
  const clean = Array.from(value.normalize("NFC"), char =>
    char.charCodeAt(0) < 32 || /[\\/:*?"<>|\u007f]/.test(char) ? "_" : char,
  ).join("").replace(/^[.\s]+|[.\s]+$/g, "") || fallback;
  const extension = clean.match(/\.[a-z0-9]{1,12}$/i)?.[0] ?? "";
  const short = clean.length > maxLength ? clean.slice(0, maxLength - extension.length) + extension : clean;
  return /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(short) ? `_${short}` : short;
}

export function collectResponseAttachments(responses: SurveyResponse[], schema: SurveySchema): ResponseAttachment[] {
  const questions = getFileQuestions(schema);
  return responses.flatMap((response, responseIndex) => questions.flatMap((question, questionIndex) => {
    const folder = `Ответ_${responseIndex + 1}_${safeArchiveName(response.id, "ответ", 36)}/${questionIndex + 1}_${safeArchiveName(question.title, "Файлы", 60)}`;
    return valuesAtPath(response.data, question.path).map((value, fileIndex) => {
      const name = isRecord(value) && typeof value.name === "string" ? value.name : "файл";
      return { archivePath: `${folder}/${fileIndex + 1}_${safeArchiveName(name, "файл")}`, value };
    });
  }));
}
