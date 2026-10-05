import type { Model, Question, QuestionCustomModel, QuestionDropdownModel, QuestionPanelDynamicModel } from "survey-core";
import { getOrganizationDisplayName, ORGANIZATION_QUESTION_TYPE } from "./model";
import type { SelectableOrganization } from "./types";

const personalOrganizationLocks = new WeakMap<Model, SelectableOrganization>();

function protectPersonalOrganizationValue(question: Question | null | undefined, value: unknown, organizationId: string): unknown {
  if (question?.getType() === ORGANIZATION_QUESTION_TYPE) return organizationId;
  if (question?.getType() !== "paneldynamic" || !Array.isArray(value)) return value;

  // A trigger can replace the whole panel array, bypassing individual fields.
  return value.map(entry => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return entry;
    const protectedEntry: Record<string, unknown> = { ...entry };
    for (const child of (question as QuestionPanelDynamicModel).template.questions) {
      const name = child.getValueName();
      if (child.getType() === ORGANIZATION_QUESTION_TYPE || name in protectedEntry) {
        protectedEntry[name] = protectPersonalOrganizationValue(child, protectedEntry[name], organizationId);
      }
    }
    return protectedEntry;
  });
}

export function applyOrganizationChoicesToSurvey(
  model: Model,
  organizations: SelectableOrganization[],
  savedOrganizations: SelectableOrganization[] = [],
  savedData: Record<string, unknown> = {},
) {
  const choices = organizations.map((organization) => ({
    value: organization.id,
    text: getOrganizationDisplayName(organization),
  }));

  model.getAllQuestions(false, false, true).forEach((question) => {
    if (question.getType() !== ORGANIZATION_QUESTION_TYPE) {
      return;
    }

    const contentQuestion = (question as QuestionCustomModel).contentQuestion as QuestionDropdownModel;
    const savedOrganization = savedOrganizations.find((organization) => organization.id === savedData[question.name]);
    contentQuestion.choices = savedOrganization && !organizations.some((organization) => organization.id === savedOrganization.id)
      ? [...choices, { value: savedOrganization.id, text: getOrganizationDisplayName(savedOrganization) }]
      : choices;
  });
}

/** Applies after drafts and before render; the server independently checks the binding. */
export function lockPersonalOrganization(model: Model, organization: SelectableOrganization) {
  const alreadyLocked = personalOrganizationLocks.has(model);
  personalOrganizationLocks.set(model, organization);
  const lockQuestion = (question: ReturnType<Model["getAllQuestions"]>[number]) => {
    if (question.getType() !== ORGANIZATION_QUESTION_TYPE) return;
    const boundOrganization = personalOrganizationLocks.get(model)!;
    const content = (question as QuestionCustomModel).contentQuestion as QuestionDropdownModel;
    // readOnly only blocks user input; expressions also run on read-only fields.
    for (const target of [question, content]) {
      target.enableIf = "";
      target.resetValueIf = "";
      target.setValueIf = "";
      target.setValueExpression = "";
      target.defaultValueExpression = "";
      target.clearIfInvisible = "none";
      target.readOnly = true;
      target.defaultValue = boundOrganization.id;
    }
    content.choices = [{ value: boundOrganization.id, text: getOrganizationDisplayName(boundOrganization) }];
    question.value = boundOrganization.id;
  };
  if (!alreadyLocked) {
    // readOnly does not stop triggers. Protect data before SurveyJS commits it.
    model.onValueChanging.add((_sender, options) => {
      options.value = protectPersonalOrganizationValue(options.question, options.value, personalOrganizationLocks.get(model)!.id);
    });
    model.onDynamicPanelValueChanging.add((_sender, options) => {
      options.value = protectPersonalOrganizationValue(options.panel.getQuestionByName(options.name), options.value, personalOrganizationLocks.get(model)!.id);
    });
    model.onQuestionCreated.add((_sender, { question }) => lockQuestion(question));
  }
  model.getAllQuestions(false, false, true).forEach(lockQuestion);
}
