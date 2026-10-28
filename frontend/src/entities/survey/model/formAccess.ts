import type { SurveyForm } from "../types";

export const FORM_EDIT_PERMISSION_ERROR = "У вас нет прав на редактирование этой формы";

export function canManageSurveyForm(
  form: Pick<SurveyForm, "author_id">,
  userId: string,
  canAdministerAllForms = false,
) {
  return form.author_id === userId || canAdministerAllForms;
}
