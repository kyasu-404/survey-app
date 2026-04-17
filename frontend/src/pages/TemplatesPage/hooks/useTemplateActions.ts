import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { routes } from "../../../app/routes";
import { useToast } from "../../../app/providers/ToastProvider";
import { changeFormStatus, getFormById, removeForm, renameForm } from "../../../entities/survey/api/surveysApi";
import {
  TEMPLATE_FORMS_QUERY_ROOT,
  getFormQueryKey,
  getSurveyFormQueryKey,
} from "../../../entities/survey/model/queryKeys";
import type { SurveyFormSummary } from "../../../entities/survey/types";
import { getErrorMessage } from "../../../shared/lib/error";
import { createPendingStateLogger } from "../../../shared/lib/reactQueryDebug";
import { scheduleQueryInvalidation } from "../../../shared/lib/queryRefresh";
import { saveSurveyBuilderDraft } from "../../../widgets/SurveyBuilder/builderDraft";
import type { TemplateActionOptions } from "../types";

export function useTemplateActions(userId: string | undefined) {
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [pendingActionKeys, setPendingActionKeys] = useState<Record<string, boolean>>({});

  const renameMutation = useMutation({
    mutationFn: ({ id, title }: { id: string; title: string }) => renameForm(id, title),
  });
  const removeMutation = useMutation({
    mutationFn: ({ id }: { id: string }) => removeForm(id),
  });
  const statusMutation = useMutation({
    mutationFn: ({ id, isPublic }: { id: string; isPublic: boolean }) => changeFormStatus(id, isPublic),
  });

  const setActionPending = (actionKey: string, isPending: boolean) => {
    setPendingActionKeys((current) => {
      if (isPending) {
        return {
          ...current,
          [actionKey]: true,
        };
      }

      const nextState = { ...current };
      delete nextState[actionKey];
      return nextState;
    });
  };

  const getTemplateActionKey = (templateId: string) => `template:${templateId}`;
  const isTemplateActionPending = (templateId: string) => Boolean(pendingActionKeys[getTemplateActionKey(templateId)]);

  const scheduleTemplatesRefresh = () => {
    scheduleQueryInvalidation(queryClient, "templates refresh", [
      { queryKey: TEMPLATE_FORMS_QUERY_ROOT },
      { queryKey: ["builder-templates"] },
    ]);
  };

  const scheduleTemplateDetailsRefresh = (templateId: string) => {
    scheduleQueryInvalidation(queryClient, `template ${templateId} refresh`, [
      { queryKey: getFormQueryKey(templateId) },
      { queryKey: getSurveyFormQueryKey(templateId) },
    ]);
  };

  const runAction = async (action: () => Promise<void>, options: TemplateActionOptions) => {
    setActionPending(options.actionKey, true);
    const stopPendingLogger = createPendingStateLogger(queryClient, options.logLabel);

    try {
      await action();
      if (options.affectedTemplateId) {
        scheduleTemplateDetailsRefresh(options.affectedTemplateId);
      }
      if (options.shouldReloadTemplates ?? true) {
        scheduleTemplatesRefresh();
      }
      showToast(options.successMessage, "success");
    } catch (error) {
      console.error(error);
      showToast(getErrorMessage(error, options.errorMessage), "error");
    } finally {
      stopPendingLogger();
      setActionPending(options.actionKey, false);
    }
  };

  const ensureTemplateDetails = async (templateId: string) => {
    return queryClient.fetchQuery({
      queryKey: ["form", templateId],
      queryFn: ({ signal }) => getFormById(templateId, { signal }),
      staleTime: 60_000,
    });
  };

  const handleRename = async (template: SurveyFormSummary) => {
    const newTitle = window.prompt("Введите новое название шаблона", template.title);
    if (!newTitle || !newTitle.trim() || newTitle === template.title) {
      return;
    }

    await runAction(() => renameMutation.mutateAsync({ id: template.id, title: newTitle.trim() }), {
      actionKey: getTemplateActionKey(template.id),
      successMessage: "Шаблон переименован",
      errorMessage: "Не удалось переименовать шаблон",
      affectedTemplateId: template.id,
      logLabel: `template rename ${template.id}`,
    });
  };

  const handleUseTemplate = async (template: SurveyFormSummary) => {
    if (!userId) {
      showToast("Для использования шаблона нужно войти в систему", "error");
      return;
    }

    const actionKey = getTemplateActionKey(template.id);
    setActionPending(actionKey, true);

    try {
      const fullTemplate = await ensureTemplateDetails(template.id);

      saveSurveyBuilderDraft(undefined, {
        ...fullTemplate.schema,
        title: fullTemplate.title,
      });
      showToast("Шаблон загружен в конструктор", "success");
      navigate(routes.builder);
    } catch (error) {
      console.error(error);
      showToast(getErrorMessage(error, "Не удалось загрузить шаблон в конструктор"), "error");
    } finally {
      setActionPending(actionKey, false);
    }
  };

  const handleToggleSharing = async (template: SurveyFormSummary) => {
    const nextStatus = !template.is_public;

    await runAction(() => statusMutation.mutateAsync({ id: template.id, isPublic: nextStatus }), {
      actionKey: getTemplateActionKey(template.id),
      successMessage: nextStatus ? "Шаблон опубликован" : "Шаблон скрыт",
      errorMessage: "Не удалось изменить доступность шаблона",
      affectedTemplateId: template.id,
      logLabel: `template share ${template.id}`,
    });
  };

  const confirmDelete = async (deletingTemplate: SurveyFormSummary) => {
    await runAction(() => removeMutation.mutateAsync({ id: deletingTemplate.id }), {
      actionKey: getTemplateActionKey(deletingTemplate.id),
      successMessage: "Шаблон удалён",
      errorMessage: "Не удалось удалить шаблон",
      affectedTemplateId: deletingTemplate.id,
      logLabel: `template delete ${deletingTemplate.id}`,
    });
  };

  return {
    confirmDelete,
    handleRename,
    handleToggleSharing,
    handleUseTemplate,
    isTemplateActionPending,
  };
}
