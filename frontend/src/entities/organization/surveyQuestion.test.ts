import { describe, expect, it } from "vitest";
import { Model, type QuestionCustomModel, type QuestionDropdownModel } from "survey-core";
import { registerCustomSurveyQuestionTypes } from "../survey/model/surveyQuestionTypes";
import { applyOrganizationChoicesToSurvey, lockPersonalOrganization } from "./surveyQuestion";

describe("applyOrganizationChoicesToSurvey", () => {
  it("fills only protected organization dropdowns with directory labels", () => {
    const organizationContent = { choices: [] as Array<{ value: string; text: string }> };
    const regularContent = { choices: [{ value: "keep", text: "Keep" }] };
    const model = {
      getAllQuestions: () => [
        { getType: () => "organization", contentQuestion: organizationContent },
        { getType: () => "dropdown", contentQuestion: regularContent },
      ],
    } as unknown as Model;

    applyOrganizationChoicesToSurvey(model, [
      { id: "school-1", organization_type: "school", number: "123", alias: "ГБОУ" },
      { id: "udod-1", organization_type: "udod", number: null, alias: "ДДТ" },
    ]);

    expect(organizationContent.choices).toEqual([
      { value: "school-1", text: "ГБОУ 123" },
      { value: "udod-1", text: "ДДТ" },
    ]);
    expect(regularContent.choices).toEqual([{ value: "keep", text: "Keep" }]);
  });
});

it("keeps a saved archive readable and selectable only in its original question", () => {
  registerCustomSurveyQuestionTypes();
  const model = new Model({ elements: [
    { type: "organization", name: "org" },
    { type: "organization", name: "other" },
  ] });
  const savedData = { org: "archived-1" };
  model.data = savedData;
  applyOrganizationChoicesToSurvey(model,
    [{ id: "active-1", organization_type: "school", number: "1", alias: "ГБОУ" }],
    [{ id: "archived-1", organization_type: "school", number: "2", alias: "ГБОУ" }],
    savedData,
  );
  const org = model.getQuestionByName("org") as QuestionCustomModel;
  const other = model.getQuestionByName("other") as QuestionCustomModel;
  expect(org.value).toBe("archived-1");
  expect(org.displayValue).toBe("ГБОУ 2");
  expect((other.contentQuestion as QuestionDropdownModel).choices.map((choice) => choice.value)).toEqual(["active-1"]);
  model.data = savedData; // Opening editing after asynchronous choice loading.
  expect(org.displayValue).toBe("ГБОУ 2");
  model.dispose();
});

it("prefills and locks organization fields after restoring a draft, including valueName and hidden fields", () => {
  registerCustomSurveyQuestionTypes();
  const model = new Model({ elements: [
    { type: "organization", name: "org", valueName: "institution", enableIf: "{q} = 1", visibleIf: "{q} = 1" },
    { type: "panel", name: "p", elements: [{ type: "organization", name: "org2" }] },
    { type: "text", name: "q" },
  ] });
  model.data = { institution: "wrong", org2: "wrong", q: "draft" };
  lockPersonalOrganization(model, { id: "locked", alias: "ГБОУ", number: "12", organization_type: "school" });
  expect(model.data).toEqual({ institution: "locked", org2: "locked", q: "draft" });
  for (const name of ["org", "org2"]) {
    const question = model.getQuestionByName(name) as QuestionCustomModel;
    expect(question.isReadOnly).toBe(true);
    expect(question.contentQuestion.isReadOnly).toBe(true);
    expect(question.displayValue).toBe("ГБОУ 12");
  }
  model.setValue("q", "1");
  expect(model.getQuestionByName("org").isReadOnly).toBe(true);
  model.setValue("q", "2");
  expect(model.data.institution).toBe("locked");
  model.dispose();
});
