import type { Model, QuestionCustomModel, QuestionDropdownModel } from "survey-core";
import { getOrganizationDisplayName, ORGANIZATION_QUESTION_TYPE } from "./model";
import type { SelectableOrganization } from "./types";

export function applyOrganizationChoicesToSurvey(
  model: Model,
  organizations: SelectableOrganization[],
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
    contentQuestion.choices = choices;
  });
}
