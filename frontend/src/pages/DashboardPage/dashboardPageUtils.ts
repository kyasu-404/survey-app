import type { SurveyFormSummary } from "../../entities/survey/types";

export function formatDateTimeLocalValue(dateTime: string | null) {
  if (!dateTime) {
    return "";
  }

  const date = new Date(dateTime);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const offsetInMs = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offsetInMs).toISOString().slice(0, 16);
}

function getResponsesLabel(count: number) {
  const absoluteCount = Math.abs(count);
  const mod10 = absoluteCount % 10;
  const mod100 = absoluteCount % 100;

  if (mod10 === 1 && mod100 !== 11) {
    return `${count} ответ`;
  }

  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) {
    return `${count} ответа`;
  }

  return `${count} ответов`;
}

export function getResponsesCounterLabel(count: number, maxResponses?: number | null) {
  if (typeof maxResponses === "number" && maxResponses > 0 && count < maxResponses) {
    return `${count}/${maxResponses} ответов`;
  }

  return getResponsesLabel(count);
}

export function isResponseLimitReached(count: number, maxResponses?: number | null) {
  return typeof maxResponses === "number" && maxResponses > 0 && count >= maxResponses;
}

export function getAuthorLabel(form: SurveyFormSummary) {
  return form.author_name || form.author_email || form.author_id;
}

export function formatDashboardCreatedAt(dateTime: string) {
  return new Date(dateTime).toLocaleString("ru-RU", {
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
    minute: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

export function formatDashboardDeadlineLabel(dateTime: string) {
  const date = new Date(dateTime);

  if (Number.isNaN(date.getTime())) {
    return dateTime;
  }

  return date.toLocaleString("ru-RU", {
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
    minute: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}
