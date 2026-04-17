import type { SurveyFormSummary } from "../../entities/survey/types";
import type { TemplatesSection } from "./types";

const PINNED_TEMPLATE_IDS_STORAGE_PREFIX = "survey-app:pinned-template-ids";

export function getPinnedTemplateIdsStorageKey(userId: string | null | undefined, section: TemplatesSection) {
  return `${PINNED_TEMPLATE_IDS_STORAGE_PREFIX}:${userId ?? "anonymous"}:${section}`;
}

export function readPinnedTemplateIds(storageKey: string) {
  if (typeof window === "undefined") {
    return [];
  }

  try {
    const value = JSON.parse(window.localStorage.getItem(storageKey) ?? "[]");
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

export function writePinnedTemplateIds(storageKey: string, templateIds: string[]) {
  window.localStorage.setItem(storageKey, JSON.stringify(templateIds));
}

export function sortTemplatesByPins(templates: SurveyFormSummary[], pinnedTemplateIds: string[]) {
  if (pinnedTemplateIds.length === 0) {
    return templates;
  }

  return templates
    .map((template, index) => ({
      index,
      pinnedIndex: pinnedTemplateIds.indexOf(template.id),
      template,
    }))
    .sort((left, right) => {
      const leftPinned = left.pinnedIndex >= 0;
      const rightPinned = right.pinnedIndex >= 0;

      if (leftPinned && rightPinned) {
        return left.pinnedIndex - right.pinnedIndex;
      }

      if (leftPinned) {
        return -1;
      }

      if (rightPinned) {
        return 1;
      }

      return left.index - right.index;
    })
    .map(({ template }) => template);
}

export function formatCreatedAt(dateTime: string) {
  return new Date(dateTime).toLocaleString("ru-RU");
}

export function getAuthorLabel(form: SurveyFormSummary) {
  return form.author_name || form.author_email || form.author_id;
}
