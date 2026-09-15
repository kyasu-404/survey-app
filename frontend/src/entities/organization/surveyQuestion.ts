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

  model.getAllQuestions().forEach((question) => {
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
