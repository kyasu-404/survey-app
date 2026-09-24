import { describe, expect, it } from "vitest";
import { Model } from "survey-core";
import { QUESTION_TYPES, QUESTION_TYPE_DEFINITIONS, registerCustomSurveyQuestionTypes } from "./surveyQuestionTypes";
import { sanitizeSurveySchema } from "./surveySchemaSecurity";
import type { SurveySchema } from "../types";
import { formatResponsesForTable } from "../../../shared/lib/responsesExport";
import { createResponseReport } from "../../../shared/lib/responseReport";

describe("section panels", () => {
  it("uses a native panel, preserves nested questions and an edited title after saving", () => {
    registerCustomSurveyQuestionTypes();
    registerCustomSurveyQuestionTypes();
    expect(QUESTION_TYPES).not.toContain("sectiontitle");
    expect(QUESTION_TYPE_DEFINITIONS[0]).toMatchObject({ name: "panel", title: "Раздел", defaultQuestionTitle: "Раздел", category: "basic" });
    const survey = new Model({ pages: [{ elements: [{
      type: "panel", name: "section1", title: "Раздел", elements: [
        { type: "text", name: "answer", title: "Ответ", isRequired: true },
      ],
    }] }] });
    const panel = survey.getPanelByName("section1");
    expect(panel.getType()).toBe("panel");
    expect(panel.isRequired).toBe(false);
    panel.title = "Информационная безопасность";
    expect(survey.validate()).toBe(false);
    survey.setValue("answer", "Проверено");
    expect(survey.validate()).toBe(true);
    expect(survey.data).toEqual({ answer: "Проверено" });
    const restored = new Model(sanitizeSurveySchema(survey.toJSON() as SurveySchema));
    expect(restored.getPanelByName("section1").title).toBe("Информационная безопасность");
    expect(restored.getPanelByName("section1").questions[0].name).toBe("answer");
    survey.dispose();
    restored.dispose();
  });

  it("limits grouping to the panel's children and analyzes their answers", () => {
    const schema: SurveySchema = { pages: [{ elements: [
      { type: "panel", name: "section1", title: "Раздел", elements: [{ type: "text", name: "answer", title: "Ответ" }] },
      { type: "panel", name: "section2", title: "Раздел", elements: [{ type: "expression", name: "total", title: "Итого" }] },
      { type: "text", name: "outside", title: "Вне разделов" },
    ] }] };
    const responses = [{ id: "r1", form_id: "f1", created_at: "2026-09-10T09:00:00Z", data: { answer: "Проверено", total: 5, outside: "Отдельно" } }];
    const table = formatResponsesForTable(responses, schema);
    expect(table.columns.map(c => c.header)).toEqual(["Дата ответа", "Раздел", "Ответ", "Раздел", "Итого", "Вне разделов"]);
    expect(table.rows[0]["section:section1"]).toBe("");
    expect(table.columns.find(c => c.key === "answer:outside")?.section).toBeUndefined();
    const report = createResponseReport(responses, schema);
    expect(report.questionReports.map(q => q.name)).toEqual(["answer", "outside"]);
    expect(report.questionReports[0].groupTitles).toEqual(["Раздел"]);
    expect(report.questionReports[1].groupTitles).toBeUndefined();
  });
});
