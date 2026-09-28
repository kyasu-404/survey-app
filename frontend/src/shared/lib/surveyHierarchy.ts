import type { SurveyQuestion } from "../../entities/survey/types";
import { answerText } from "./answerValue";

export type SurveySection = { key: string; header: string };

/** A heading applies to following siblings; each container starts its own scope. */
export function* sectionSiblings(elements: SurveyQuestion[], parents: SurveySection[] = [], scope = "") {
  let heading: SurveySection | undefined;
  for (const [index, question] of elements.entries()) {
    if (!question || typeof question !== "object") continue;
    const path = `${scope}.${index}`;
    const group = ["panel", "sectiontitle"].includes(question.type)
      ? { key: `section:${question.name || path}`, header: answerText(question.title).trim() || (question.type === "panel" ? "Раздел" : "Название раздела") }
      : undefined;
    if (question.type === "sectiontitle") heading = group;
    const sections = [...parents, ...(heading ? [heading] : []), ...(question.type === "panel" && group ? [group] : [])];
    yield { question, sections, group, path };
  }
}
