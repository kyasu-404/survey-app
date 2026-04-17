import { useState } from "react";
import { useQueryClient, type QueryKey } from "@tanstack/react-query";
import { useToast } from "../../../app/providers/ToastProvider";
import { getFormQueryKey, getSurveyFormQueryKey } from "../../../entities/survey/model/queryKeys";
import { getErrorMessage } from "../../../shared/lib/error";
import { createPendingStateLogger } from "../../../shared/lib/reactQueryDebug";
import { scheduleQueryInvalidation } from "../../../shared/lib/queryRefresh";
import type { DashboardActionOptions } from "../types";

type UseDashboardActionRunnerOptions = {
  formsQueryKey: QueryKey;
  formsStatsQueryKey: QueryKey;
};

export function useDashboardActionRunner({ formsQueryKey, formsStatsQueryKey }: UseDashboardActionRunnerOptions) {
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const [pendingActionKeys, setPendingActionKeys] = useState<Record<string, boolean>>({});

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

  const getFormActionKey = (formId: string) => `form:${formId}`;
  const isFormActionPending = (formId: string) => Boolean(pendingActionKeys[getFormActionKey(formId)]);

  const scheduleFormsRefresh = () => {
    scheduleQueryInvalidation(queryClient, "dashboard forms refresh", [
      { queryKey: formsQueryKey },
      { queryKey: formsStatsQueryKey },
    ]);
  };

  const scheduleFormDetailsRefresh = (formId: string) => {
    scheduleQueryInvalidation(queryClient, `dashboard form ${formId} refresh`, [
      { queryKey: getFormQueryKey(formId) },
      { queryKey: getSurveyFormQueryKey(formId) },
    ]);
  };

  const runAction = async (action: () => Promise<unknown>, options: DashboardActionOptions) => {
    setActionPending(options.actionKey, true);
    const stopPendingLogger = createPendingStateLogger(queryClient, options.logLabel);

    try {
      await action();
      if (options.affectedFormId) {
        scheduleFormDetailsRefresh(options.affectedFormId);
      }
      if (options.shouldReloadForms ?? true) {
        scheduleFormsRefresh();
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

  return {
    getFormActionKey,
    isFormActionPending,
    runAction,
  };
}
