import { useState } from "react";
import { useQueryClient, type QueryKey } from "@tanstack/react-query";
import { useToast } from "../../../app/providers/ToastProvider";
import { getFormById } from "../../../entities/survey/api/surveysApi";
import type { SurveyFormSummary } from "../../../entities/survey/types";
import type { DashboardShowToast } from "../types";
import { useDashboardActionRunner } from "./useDashboardActionRunner";
import { useDashboardMutations } from "./useDashboardMutations";
import { useDashboardSettingsActions } from "./useDashboardSettingsActions";

type UseDashboardActionsOptions = {
  formsQueryKey: QueryKey;
  formsStatsQueryKey: QueryKey;
  userId?: string;
};

export function useDashboardActions({ formsQueryKey, formsStatsQueryKey, userId }: UseDashboardActionsOptions) {
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const [formToDelete, setFormToDelete] = useState<SurveyFormSummary | null>(null);
  const {
    deadlineMutation,
    duplicateMutation,
    removeMutation,
    renameMutation,
    responseLimitMutation,
    statusMutation,
  } = useDashboardMutations();
  const { getFormActionKey, isFormActionPending, runAction } = useDashboardActionRunner({
    formsQueryKey,
    formsStatsQueryKey,
  });
  const settingsActions = useDashboardSettingsActions({
    clearDeadlineAction: (formId) => deadlineMutation.mutateAsync({ id: formId, deadlineAt: null }),
    clearResponseLimitAction: (formId) => responseLimitMutation.mutateAsync({ id: formId, maxResponses: null }),
    getFormActionKey,
    runAction,
    saveDeadlineAction: (formId, deadlineAt) => deadlineMutation.mutateAsync({ id: formId, deadlineAt }),
    saveResponseLimitAction: (formId, maxResponses) => responseLimitMutation.mutateAsync({ id: formId, maxResponses }),
    showToast: showToast as DashboardShowToast,
  });

  const handleRename = async (form: SurveyFormSummary) => {
    const newTitle = window.prompt("Введите новое название формы", form.title);
    if (!newTitle || !newTitle.trim() || newTitle === form.title) {
      return;
    }

    await runAction(() => renameMutation.mutateAsync({ id: form.id, title: newTitle.trim() }), {
      actionKey: getFormActionKey(form.id),
      successMessage: "Форма сохранена",
      errorMessage: "Не удалось переименовать форму",
      affectedFormId: form.id,
      logLabel: `dashboard rename ${form.id}`,
    });
  };

  const confirmDelete = async () => {
    if (!formToDelete) {
      return;
    }

    const deletingForm = formToDelete;
    setFormToDelete(null);
    await runAction(() => removeMutation.mutateAsync({ id: deletingForm.id }), {
      actionKey: getFormActionKey(deletingForm.id),
      successMessage: "Форма удалена",
      errorMessage: "Не удалось удалить форму",
      affectedFormId: deletingForm.id,
      logLabel: `dashboard delete ${deletingForm.id}`,
    });
  };

  const handleDuplicate = async (form: SurveyFormSummary) => {
    if (!userId) {
      showToast("Для дублирования формы нужно войти в систему", "error");
      return;
    }

    await runAction(async () => {
      const fullForm = await queryClient.fetchQuery({
        queryKey: ["form", form.id],
        queryFn: ({ signal }) => getFormById(form.id, { signal }),
        staleTime: 60_000,
      });

      await duplicateMutation.mutateAsync({ form: fullForm, authorId: userId });
    }, {
      actionKey: getFormActionKey(form.id),
      successMessage: "Форма сохранена",
      errorMessage: "Не удалось дублировать форму",
      logLabel: `dashboard duplicate ${form.id}`,
    });
  };

  const handleToggleFormStatus = async (form: SurveyFormSummary) => {
    const nextStatus = !form.is_public;

    if (!nextStatus && form.deadline_at) {
      const shouldContinue = window.confirm(
        "Закрытие публичной формы приведёт к удалению текущего дедлайна. Вы хотите продолжить?",
      );

      if (!shouldContinue) {
        return;
      }
    }

    await runAction(async () => {
      if (!nextStatus && form.deadline_at) {
        await deadlineMutation.mutateAsync({ id: form.id, deadlineAt: null });
      }

      await statusMutation.mutateAsync({ id: form.id, isPublic: nextStatus });
    }, {
      actionKey: getFormActionKey(form.id),
      successMessage: nextStatus ? "Форма открыта" : "Форма закрыта",
      errorMessage: "Не удалось изменить статус формы",
      affectedFormId: form.id,
      logLabel: `dashboard status ${form.id}`,
    });
  };

  return {
    confirmDelete,
    formToDelete,
    handleDuplicate,
    handleRename,
    handleToggleFormStatus,
    isFormActionPending,
    setFormToDelete,
    ...settingsActions,
  };
}
