import type { SurveyResponse } from "../types";
import type { SurveyPageSchema, SurveyQuestion, SurveySchema } from "../../survey/types";

export type ResponsesTableRow = Record<string, string>;

function getQuestionChoiceMap(schema: SurveySchema) {
  const questions = schema.pages.flatMap((page: SurveyPageSchema) => page.elements ?? []);
  const choicesMap = new Map<string, Map<string, string>>();

  questions.forEach((question: SurveyQuestion) => {
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
      choicesMap.set(question.name, questionChoiceMap);
    }
  });

  return choicesMap;
}

function formatAnswerValue(questionName: string, value: unknown, choiceMap: Map<string, Map<string, string>>): string {
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

    return JSON.stringify(value);
  }

  return String(value);
}

export function formatResponsesForTable(responses: SurveyResponse[], schema: SurveySchema): ResponsesTableRow[] {
  const choiceMap = getQuestionChoiceMap(schema);

  return responses.map((response) => {
    const base: ResponsesTableRow = {
      "Дата ответа": new Date(response.created_at).toLocaleString("ru-RU"),
    };

    Object.entries(response.data).forEach(([key, value]) => {
      base[key] = formatAnswerValue(key, value, choiceMap);
    });

    return base;
  });
}
