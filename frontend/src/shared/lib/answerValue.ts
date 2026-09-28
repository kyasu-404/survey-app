/** Text representation of SurveyJS values. Never evaluates survey expressions. */
export type AnswerDefinition = Record<string, unknown>;
export const COMPLEX_ANSWER_TYPES = new Set(["paneldynamic", "matrix", "matrixdropdown", "matrixdynamic", "multipletext", "ranking", "comment"]);
export const isAnswerRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
export const answerText = (value: unknown): string => {
  if (isAnswerRecord(value)) return answerText(value.ru ?? value.default ?? Object.values(value)[0]);
  return value === null || value === undefined ? "" : String(value);
};
export function answerLabel(items: unknown, value: unknown): string {
  const item = Array.isArray(items) ? items.find(item => String(isAnswerRecord(item) ? item.value ?? item.name : item) === String(value)) : undefined;
  return (isAnswerRecord(item) ? answerText(item.text ?? item.title).trim() : "") || answerText(value);
}
export function answerCommentKey(question: AnswerDefinition, suffix = "-Comment") {
  return `${question.valueName || question.name}${suffix}`;
}
export function hasAnswerComment(question: AnswerDefinition) {
  return Boolean(question.showOtherItem || question.showCommentArea || question.hasOther || question.hasComment);
}
export function readableValue(value: unknown, depth = 0): string {
  if (depth > 32) return "[Значение превышает допустимую сложность]";
  if (Array.isArray(value)) return value.map(item => readableValue(item, depth + 1)).join(", ");
  if (isAnswerRecord(value)) return Object.entries(value).map(([key, item]) => `${key}: ${readableValue(item, depth + 1)}`).join("\n");
  return answerText(value);
}

export function formatSimpleAnswer(question: AnswerDefinition, value: unknown, siblings: Record<string, unknown> = {}, suffix = "-Comment", organizations?: Map<string, string>): string {
  if (value === null || value === undefined) {
    const comment = siblings[answerCommentKey(question, suffix)];
    return hasAnswerComment(question) && typeof comment === "string" && comment ? `Комментарий: ${comment}` : "";
  }
  const type = question.type;
  const label = (item: unknown): string => {
    if (isAnswerRecord(item)) {
      const key = String(question.valuePropertyName || "value");
      const note = String(question.commentPropertyName || "comment");
      if (Object.prototype.hasOwnProperty.call(item, key)) return [label(item[key]), answerText(item[note])].filter(Boolean).join(": ");
      return readableValue(item);
    }
    if (type === "organization") return organizations?.get(String(item)) ?? answerText(item);
    if ((question.showOtherItem || question.hasOther) && item === (question.otherItemValue ?? "other")) {
      return answerText(siblings[answerCommentKey(question, suffix)]).trim() || answerText(question.otherText) || "Другое";
    }
    if (question.showNoneItem && item === (question.noneItemValue ?? "none")) return answerText(question.noneText) || "Ничего из перечисленного";
    if (type === "boolean") {
      if (item === (question.valueTrue ?? true)) return answerText(question.labelTrue) || "Да";
      if (item === (question.valueFalse ?? false)) return answerText(question.labelFalse) || "Нет";
    }
    return answerLabel(type === "rating" ? question.rateValues : question.choices, item);
  };
  let text: string;
  if (type === "file") text = (Array.isArray(value) ? value : [value]).map(file => isAnswerRecord(file) ? answerText(file.name) || "Файл" : "Файл").join(", ");
  else if (Array.isArray(value)) text = value.map((item, index) => type === "ranking" ? `${index + 1}. ${label(item)}` : label(item)).join(type === "ranking" ? "\n" : ", ");
  else text = label(value);
  const inputType = question.inputType || type;
  if (["date", "datetime", "datetime-local"].includes(String(inputType))) {
    // A datetime-local answer has no timezone; do not shift it through Date/UTC.
    const parts = text.match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}:\d{2}(?::\d{2})?))?$/);
    if (parts) text = `${parts[3]}.${parts[2]}.${parts[1]}${parts[4] ? ` ${parts[4]}` : ""}`;
  }
  const comment = siblings[answerCommentKey(question, suffix)];
  const isOther = (Array.isArray(value) ? value : [value]).includes(question.otherItemValue ?? "other");
  if (typeof comment === "string" && comment && !isOther && hasAnswerComment(question)) text += `\nКомментарий: ${comment}`;
  return text;
}

export function matrixCellDefinition(question: AnswerDefinition, name: string): AnswerDefinition {
  const column = Array.isArray(question.columns) ? question.columns.find(column => isAnswerRecord(column) && column.name === name) : undefined;
  const definition = isAnswerRecord(column) ? column : {};
  return { choices: question.choices, ...definition, name, type: definition.cellType || question.cellType || "dropdown" };
}

export function formatMatrixAnswer(question: AnswerDefinition, value: unknown, suffix = "-Comment", organizations?: Map<string, string>): string {
  const cells = (row: unknown) => {
    if (!isAnswerRecord(row)) return readableValue(row);
    return Object.entries(row).filter(([name]) => !Object.keys(row).some(key => name === answerCommentKey(matrixCellDefinition(question, key), suffix) && hasAnswerComment(matrixCellDefinition(question, key))))
      .map(([name, cell]) => `${answerLabel(question.columns, name)}: ${formatSimpleAnswer(matrixCellDefinition(question, name), cell, row, suffix, organizations) || "—"}`).join("\n");
  };
  if (question.type === "matrixdynamic" && Array.isArray(value)) return value.map((row, index) => `Строка ${index + 1}\n${cells(row)}`).join("\n\n");
  if (!isAnswerRecord(value)) return readableValue(value);
  return Object.entries(value).map(([name, answer]) => {
    if (question.type === "matrixdropdown") return `${answerLabel(question.rows, name)}\n${cells(answer).replace(/^/gm, "  ")}`;
    if (question.type === "multipletext") {
      const item = Array.isArray(question.items) ? question.items.find(item => isAnswerRecord(item) && item.name === name) : undefined;
      return `${answerLabel(question.items, name)}: ${formatSimpleAnswer({ type: "text", ...(isAnswerRecord(item) ? item : {}) }, answer) || "—"}`;
    }
    return `${answerLabel(question.rows, name)}: ${Array.isArray(answer) ? answer.map(item => answerLabel(question.columns, item)).join(", ") : answerLabel(question.columns, answer)}`;
  }).join("\n");
}
