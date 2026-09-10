import { describe, expect, it } from "vitest";
import { Model, type QuestionCustomModel } from "survey-core";
import { registerCustomSurveyQuestionTypes } from "./surveyQuestionTypes";
import { sanitizeSurveySchema } from "./surveySchemaSecurity";
import type { SurveySchema } from "../types";
import { formatResponsesForTable } from "../../../shared/lib/responsesExport";
import { createResponseReport } from "../../../shared/lib/responseReport";

describe("section title question", () => {
  it("uses expression rendering, preserves an edited title after saving, and needs no answer", () => {
    registerCustomSurveyQuestionTypes();
    registerCustomSurveyQuestionTypes();
    const survey = new Model({ pages: [{ elements: [
      { type: "sectiontitle", name: "section1", title: "Название раздела" },
      { type: "text", name: "answer", title: "Ответ", isRequired: true },
    ] }] });
    const heading = survey.getQuestionByName("section1") as QuestionCustomModel;
    expect(heading.contentQuestion.getType()).toBe("expression");
    expect(heading.title).toBe("Название раздела");
    expect(heading.isRequired).toBe(false);
    expect(heading.contentQuestion.hasInput).toBe(false);
    heading.title = "Информационная безопасность";
    survey.setValue("answer", "Проверено");
    expect(survey.validate()).toBe(true);
    expect(survey.data).toEqual({ answer: "Проверено" });

    const restored = new Model(sanitizeSurveySchema(survey.toJSON() as SurveySchema));
    expect(restored.getQuestionByName("section1").getType()).toBe("sectiontitle");
    expect(restored.getQuestionByName("section1").title).toBe("Информационная безопасность");
    expect(restored.getQuestionByName("section1").isRequired).toBe(false);
    survey.dispose();
    restored.dispose();
  });

  it("shows section headings as empty separators in responses and excludes them from statistics", () => {
    const schema: SurveySchema = { pages: [{ elements: [
      { type: "sectiontitle", name: "section1", title: "Раздел" },
      { type: "text", name: "answer", title: "Ответ" },
      { type: "sectiontitle", name: "section2", title: "Раздел" },
      { type: "expression", name: "total", title: "Итого" },
    ] }] };
    const responses = [{ id: "r1", form_id: "f1", created_at: "2026-09-10T09:00:00Z", data: { answer: "Проверено", total: 5 } }];
    const table = formatResponsesForTable(responses, schema);
    expect(table.columns.map(c => c.header)).toEqual(["Дата ответа", "Раздел", "Ответ", "Раздел", "Итого"]);
    expect(table.rows[0]["section:section1"]).toBe("");
    expect(table.rows[0]["section:section2"]).toBe("");
    expect(createResponseReport(responses, schema).questionReports.map(q => q.name)).toEqual(["answer"]);
  });
});
