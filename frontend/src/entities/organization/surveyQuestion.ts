import type { Model, QuestionCustomModel, QuestionDropdownModel } from "survey-core";
import { getOrganizationDisplayName, ORGANIZATION_QUESTION_TYPE } from "./model";
import type { SelectableOrganization } from "./types";

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
  const lockQuestion = (question: ReturnType<Model["getAllQuestions"]>[number]) => {
    if (question.getType() !== ORGANIZATION_QUESTION_TYPE) return;
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
      target.defaultValue = organization.id;
    }
    content.choices = [{ value: organization.id, text: getOrganizationDisplayName(organization) }];
    question.value = organization.id;
  };
  model.getAllQuestions(false, false, true).forEach(lockQuestion);
  model.onQuestionCreated.add((_sender, { question }) => lockQuestion(question));
}
