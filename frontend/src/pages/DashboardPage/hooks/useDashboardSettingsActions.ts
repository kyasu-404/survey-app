import { useState } from "react";
import { formatDateTimeLocalValue } from "../dashboardPageUtils";
import type {
  DashboardRunAction,
  DashboardShowToast,
  DeadlineEditorState,
  ResponseLimitEditorState,
} from "../types";
import type { SurveyFormSummary } from "../../../entities/survey/types";

type UseDashboardSettingsActionsOptions = {
  clearDeadlineAction: (formId: string) => Promise<unknown>;
  clearResponseLimitAction: (formId: string) => Promise<unknown>;
  getFormActionKey: (formId: string) => string;
  runAction: DashboardRunAction;
  saveDeadlineAction: (formId: string, deadlineAt: string) => Promise<unknown>;
  saveResponseLimitAction: (formId: string, maxResponses: number) => Promise<unknown>;
  showToast: DashboardShowToast;
};

export function useDashboardSettingsActions({
  clearDeadlineAction,
  clearResponseLimitAction,
  getFormActionKey,
  runAction,
  saveDeadlineAction,
  saveResponseLimitAction,
  showToast,
}: UseDashboardSettingsActionsOptions) {
  const [deadlineEditor, setDeadlineEditor] = useState<DeadlineEditorState | null>(null);
  const [responseLimitEditor, setResponseLimitEditor] = useState<ResponseLimitEditorState | null>(null);

  const openDeadlineEditor = (form: SurveyFormSummary) => {
    setDeadlineEditor({ form, value: formatDateTimeLocalValue(form.deadline_at) });
  };

  const openResponseLimitEditor = (form: SurveyFormSummary) => {
    setResponseLimitEditor({
      form,
      value: form.max_responses ? String(form.max_responses) : "",
    });
  };

  const updateDeadlineEditorValue = (value: string) => {
    setDeadlineEditor((current) => (current ? { ...current, value } : current));
  };

  const updateResponseLimitEditorValue = (value: string) => {
    setResponseLimitEditor((current) => (current ? { ...current, value } : current));
  };

  const clearDeadline = async () => {
    if (!deadlineEditor) {
      return;
    }

    await runAction(() => clearDeadlineAction(deadlineEditor.form.id), {
      actionKey: getFormActionKey(deadlineEditor.form.id),
      successMessage: "Дедлайн снят",
      errorMessage: "Не удалось обновить дедлайн",
      affectedFormId: deadlineEditor.form.id,
      logLabel: `dashboard deadline clear ${deadlineEditor.form.id}`,
    }).finally(() => setDeadlineEditor(null));
  };

  const saveDeadline = async () => {
    if (!deadlineEditor) {
      return;
    }

    const normalizedInput = deadlineEditor.value.trim();
    if (!normalizedInput) {
      showToast("Выберите дату и время или снимите дедлайн", "error");
      return;
    }

    const parsedDate = new Date(normalizedInput);
    if (Number.isNaN(parsedDate.getTime())) {
      showToast("Некорректный формат даты дедлайна", "error");
      return;
    }

    await runAction(() => saveDeadlineAction(deadlineEditor.form.id, parsedDate.toISOString()), {
      actionKey: getFormActionKey(deadlineEditor.form.id),
      successMessage: "Дедлайн установлен",
      errorMessage: "Не удалось обновить дедлайн",
      affectedFormId: deadlineEditor.form.id,
      logLabel: `dashboard deadline save ${deadlineEditor.form.id}`,
    }).finally(() => setDeadlineEditor(null));
  };

  const clearResponseLimit = async () => {
    if (!responseLimitEditor) {
      return;
    }

    await runAction(() => clearResponseLimitAction(responseLimitEditor.form.id), {
      actionKey: getFormActionKey(responseLimitEditor.form.id),
      successMessage: "Ограничение снято",
      errorMessage: "Не удалось обновить ограничение",
      affectedFormId: responseLimitEditor.form.id,
      logLabel: `dashboard response limit clear ${responseLimitEditor.form.id}`,
    }).finally(() => setResponseLimitEditor(null));
  };

  const saveResponseLimit = async () => {
    if (!responseLimitEditor) {
      return;
    }

    const normalizedInput = responseLimitEditor.value.trim();
    const parsedLimit = Number(normalizedInput);

    if (!normalizedInput || !Number.isInteger(parsedLimit) || parsedLimit <= 0) {
      showToast("Укажите положительное целое число ответов", "error");
      return;
    }

    if (parsedLimit < (responseLimitEditor.form.responses_count ?? 0)) {
      showToast("Лимит ответов не может быть меньше количества уже полученных ответов", "error");
      return;
    }

    await runAction(() => saveResponseLimitAction(responseLimitEditor.form.id, parsedLimit), {
      actionKey: getFormActionKey(responseLimitEditor.form.id),
      successMessage: "Ограничение сохранено",
      errorMessage: "Не удалось обновить ограничение",
      affectedFormId: responseLimitEditor.form.id,
      logLabel: `dashboard response limit save ${responseLimitEditor.form.id}`,
    }).finally(() => setResponseLimitEditor(null));
  };

  return {
    clearDeadline,
    clearResponseLimit,
    deadlineEditor,
    openDeadlineEditor,
    openResponseLimitEditor,
    responseLimitEditor,
    saveDeadline,
    saveResponseLimit,
    setDeadlineEditor,
    setResponseLimitEditor,
    updateDeadlineEditorValue,
    updateResponseLimitEditorValue,
  };
}
