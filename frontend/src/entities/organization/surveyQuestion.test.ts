import { describe, expect, it } from "vitest";
import { EventBase, Model, type QuestionCustomModel, type QuestionDropdownModel, type QuestionPanelDynamicModel } from "survey-core";
import { registerCustomSurveyQuestionTypes } from "../survey/model/surveyQuestionTypes";
import { applyOrganizationChoicesToSurvey, lockPersonalOrganization } from "./surveyQuestion";

describe("applyOrganizationChoicesToSurvey", () => {
  it("fills only protected organization dropdowns with directory labels", () => {
    const organizationContent = { choices: [] as Array<{ value: string; text: string }> };
    const regularContent = { choices: [{ value: "keep", text: "Keep" }] };
    const model = {
      onQuestionCreated: new EventBase(),
      onValueChanged: new EventBase(),
      getAllQuestions: () => [
        { getType: () => "organization", getValueName: () => "org", contentQuestion: organizationContent },
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

it("keeps archives at their saved valueName and dynamic entry paths when editing is opened later", async () => {
  registerCustomSurveyQuestionTypes();
  const model = new Model({ elements: [
    { type: "organization", name: "root", valueName: "institution" },
    { type: "paneldynamic", name: "entries", valueName: "records", templateElements: [
      { type: "panel", name: "details", elements: [{ type: "organization", name: "org", valueName: "institution" }] },
      { type: "paneldynamic", name: "children", templateElements: [{ type: "organization", name: "nested" }] },
    ] },
  ] });
  const savedData = { institution: "archive-1", records: [
    { institution: "archive-2", children: [{ nested: "archive-1" }] },
    { institution: "active" },
  ] };
  const active = [{ id: "active", organization_type: "school" as const, number: "1", alias: "School" }];
  const archived = [1, 2].map(i => ({ id: `archive-${i}`, organization_type: "school" as const, number: String(i + 1), alias: "School" }));
  applyOrganizationChoicesToSurvey(model, active, archived, savedData);
  model.data = savedData;
  await Promise.resolve();
  const entries = model.getQuestionByName("entries") as QuestionPanelDynamicModel;
  expect(model.getQuestionByName("root").displayValue).toBe("School 2");
  expect(entries.panels[0].getQuestionByName("org").displayValue).toBe("School 3");
  const children = entries.panels[0].getQuestionByName("children") as QuestionPanelDynamicModel;
  expect(children.panels[0].getQuestionByName("nested").displayValue).toBe("School 2");
  expect(((entries.panels[1].getQuestionByName("org") as QuestionCustomModel).contentQuestion as QuestionDropdownModel).choices.map(c => c.value)).toEqual(["active"]);
  entries.addPanel();
  const added = entries.panels[2].getQuestionByName("org") as QuestionCustomModel;
  expect((added.contentQuestion as QuestionDropdownModel).choices.map(c => c.value)).toEqual(["active"]);
  // Repeated directory loads must update the single creation handler.
  applyOrganizationChoicesToSurvey(model, [{ ...active[0], id: "updated" }], archived, savedData);
  children.addPanel();
  const nestedAdded = children.panels[1].getQuestionByName("nested") as QuestionCustomModel;
  expect((nestedAdded.contentQuestion as QuestionDropdownModel).choices.map(c => c.value)).toEqual(["updated"]);
  model.dispose();
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

it("locks existing and newly added nested dynamic panels using their valueName", () => {
  registerCustomSurveyQuestionTypes();
  const model = new Model({ elements: [{
    type: "paneldynamic", name: "entries", valueName: "records", panelCount: 1,
    templateElements: [
      { type: "organization", name: "org", valueName: "institution" },
      { type: "paneldynamic", name: "children", panelCount: 1, templateElements: [{ type: "organization", name: "nestedOrg" }] },
    ],
  }] });
  model.data = { records: [{ institution: "wrong", children: [{ nestedOrg: "wrong" }] }] };
  lockPersonalOrganization(model, { id: "locked", alias: "ГБОУ", number: "12", organization_type: "school" });
  const entries = model.getQuestionByName("entries") as QuestionPanelDynamicModel;
  entries.addPanel();
  for (const panel of entries.panels) {
    const children = panel.getQuestionByName("children") as QuestionPanelDynamicModel;
    children.addPanel();
  }
  expect(model.data).toEqual({ records: [
    { institution: "locked", children: [{ nestedOrg: "locked" }, { nestedOrg: "locked" }] },
    { institution: "locked", children: [{ nestedOrg: "locked" }, { nestedOrg: "locked" }] },
  ] });
  for (const question of model.getAllQuestions(false, false, true).filter(q => q.getType() === "organization")) {
    expect(question.isReadOnly).toBe(true);
    expect((question as QuestionCustomModel).contentQuestion.isReadOnly).toBe(true);
    expect(question.displayValue).toBe("ГБОУ 12");
  }
  model.dispose();
});

it.each([
  { resetValueIf: "{q} = 'reset'" },
  { setValueIf: "{q} = 'reset'", setValueExpression: "'wrong'" },
  { setValueExpression: "iif({q} = 'reset', 'wrong', 'locked')" },
  { defaultValueExpression: "iif({q} = 'reset', 'wrong', 'locked')" },
])("keeps a personal organization bound when conditions run: %j", (conditions) => {
  registerCustomSurveyQuestionTypes();
  const model = new Model({ elements: [
    { type: "organization", name: "org", ...conditions },
    { type: "text", name: "q" },
  ] });
  lockPersonalOrganization(model, { id: "locked", alias: "ГБОУ", number: "12", organization_type: "school" });
  model.setValue("q", "reset");
  expect(model.data.org).toBe("locked");
  model.setValue("q", "other");
  expect(model.data.org).toBe("locked");
  model.dispose();
});

it("disables value expressions in existing and new dynamic entries", () => {
  registerCustomSurveyQuestionTypes();
  const model = new Model({ elements: [{
    type: "paneldynamic", name: "entries", panelCount: 1, templateElements: [
      { type: "organization", name: "org", resetValueIf: "{panel.q} = 'reset'", setValueExpression: "iif({panel.q} = 'replace', 'wrong', 'locked')" },
      { type: "text", name: "q" },
    ],
  }] });
  lockPersonalOrganization(model, { id: "locked", alias: "ГБОУ", number: "12", organization_type: "school" });
  const entries = model.getQuestionByName("entries") as QuestionPanelDynamicModel;
  entries.addPanel();
  for (const panel of entries.panels) {
    const org = panel.getQuestionByName("org") as QuestionCustomModel;
    for (const value of ["reset", "replace"]) {
      panel.getQuestionByName("q").value = value;
      expect(org.value).toBe("locked");
      expect(org.contentQuestion.isReadOnly).toBe(true);
    }
  }
  model.dispose();
});

const organizationTriggers = [
  { type: "setvalue", setValue: "wrong" },
  { type: "copyvalue", fromName: "source" },
  { type: "runexpression", runExpression: "{source}" },
];

it.each(organizationTriggers)("protects root organizations from $type triggers while other triggers still run", (trigger) => {
  registerCustomSurveyQuestionTypes();
  for (const [valueName, target] of [[undefined, "org"], ["institution", "org"], ["institution", "institution"]]) {
    const model = new Model({ elements: [
      { type: "organization", name: "org", valueName, isRequired: true },
      { type: "text", name: "q" }, { type: "text", name: "source" }, { type: "text", name: "other" },
    ], triggers: [
      { ...trigger, expression: "{q} = 'go'", setToName: target },
      { ...trigger, expression: "{q} = 'go'", setToName: "other" },
    ] });
    model.setValue("source", "wrong");
    lockPersonalOrganization(model, { id: "locked", alias: "ГБОУ", number: "12", organization_type: "school" });
    model.setValue("q", "go");
    const org = model.getQuestionByName("org") as QuestionCustomModel;
    expect(model.data[valueName ?? "org"]).toBe("locked");
    expect(org.value).toBe("locked");
    expect(org.contentQuestion.value).toBe("locked");
    expect(org.displayValue).toBe("ГБОУ 12");
    expect(org.isReadOnly).toBe(true);
    expect(model.data.other).toBe("wrong");
    expect(model.validate()).toBe(true);
    model.dispose();
  }
});

it.each(organizationTriggers)("protects existing and new dynamic entry organizations from $type triggers", (trigger) => {
  registerCustomSurveyQuestionTypes();
  const model = new Model({ elements: [
    { type: "text", name: "q" }, { type: "text", name: "source" },
    { type: "paneldynamic", name: "entries", valueName: "records", panelCount: 1, templateElements: [
      { type: "organization", name: "org", valueName: "institution", isRequired: true },
    ] },
  ], triggers: [0, 1].map(index => ({ ...trigger, expression: "{q} = 'go'", setToName: `records[${index}].institution` })) });
  model.setValue("source", "wrong");
  lockPersonalOrganization(model, { id: "locked", alias: "ГБОУ", number: "12", organization_type: "school" });
  const entries = model.getQuestionByName("entries") as QuestionPanelDynamicModel;
  entries.addPanel();
  model.setValue("q", "go");
  expect(model.data.records).toEqual([{ institution: "locked" }, { institution: "locked" }]);
  for (const panel of entries.panels) {
    const org = panel.getQuestionByName("org") as QuestionCustomModel;
    expect(org.value).toBe("locked");
    expect(org.contentQuestion.value).toBe("locked");
    expect(org.isReadOnly).toBe(true);
  }
  expect(model.validate()).toBe(true);
  model.dispose();
});

it("protects organizations when a trigger replaces an entire dynamic panel value", () => {
  registerCustomSurveyQuestionTypes();
  const replacement = [{ institution: "wrong", answer: "copied", children: [{ nestedOrg: "wrong" }] }];
  const model = new Model({ elements: [
    { type: "text", name: "q" },
    { type: "paneldynamic", name: "entries", valueName: "records", panelCount: 1, templateElements: [
      { type: "organization", name: "org", valueName: "institution" }, { type: "text", name: "answer" },
      { type: "paneldynamic", name: "children", panelCount: 1, templateElements: [{ type: "organization", name: "nestedOrg" }] },
    ] },
  ], triggers: [{ type: "setvalue", expression: "{q} = 'go'", setValue: replacement, setToName: "records" }] });
  lockPersonalOrganization(model, { id: "locked", alias: "ГБОУ", number: "12", organization_type: "school" });
  model.setValue("q", "go");
  expect(model.data.records).toEqual([{ institution: "locked", answer: "copied", children: [{ nestedOrg: "locked" }] }]);
  expect(model.toJSON().triggers[0].setValue).toEqual(replacement);
  model.dispose();
});
