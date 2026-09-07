import { useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { getDashboardFormsStats } from "../../../entities/survey/api/surveysApi";
import { getDashboardFormStatsQueryKey } from "../../../entities/survey/model/queryKeys";
import { isTemplateForm } from "../../../entities/survey/model/surveyModel";
import type { SurveyFormSummary } from "../../../entities/survey/types";
import type { DashboardListFilters, DashboardViewMode } from "../types";
import { getNextDeadlineRefreshDelayMs } from "../../../entities/survey/model/deadlineState";
import { MAX_TIMEOUT_MS } from "../dashboardPageConstants";

type DashboardFilterState = {
  dateFrom: string;
  dateTo: string;
  formReason: string;
  formType: string;
  listFilters: DashboardListFilters;
  normalizedSearch: string;
};

type UseDashboardStatsOptions = {
  filteredForms: SurveyFormSummary[];
  loadedForms: SurveyFormSummary[];
  filters: DashboardFilterState;
  isAuthLoading: boolean;
  loadedFormsTotalCount: number;
  userId?: string;
  viewMode: DashboardViewMode;
};

export function useDashboardStats({
  filteredForms,
  loadedForms,
  filters,
  isAuthLoading,
  loadedFormsTotalCount,
  userId,
  viewMode,
}: UseDashboardStatsOptions) {
  const formsStatsQueryKey = useMemo(
    () =>
      getDashboardFormStatsQueryKey({
        dateFrom: filters.dateFrom,
        dateTo: filters.dateTo,
        formReason: filters.formReason,
        formType: filters.formType,
        search: filters.normalizedSearch,
        viewMode,
        userId: userId ?? null,
      }),
    [filters.dateFrom, filters.dateTo, filters.formReason, filters.formType, filters.normalizedSearch, userId, viewMode],
  );

  const { data: formsStats, dataUpdatedAt, refetch, error } = useQuery({
    queryKey: formsStatsQueryKey,
    queryFn: ({ signal }) => getDashboardFormsStats(filters.listFilters, { signal }),
    enabled: !isAuthLoading && (viewMode === "all" || Boolean(userId)),
    retry: 1,
    staleTime: 30_000,
    refetchOnMount: "always",
    refetchOnWindowFocus: false,
    refetchOnReconnect: true,
    // Deadlines on forms beyond "Show more" also affect the global totals.
    refetchInterval: (query) => (query.state.data?.formsWithDeadlineCount ?? 0) > 0 ? 30_000 : false,
  });

  useEffect(() => {
    const delay = getNextDeadlineRefreshDelayMs(loadedForms);
    if (delay === null) return;
    const timeoutId = window.setTimeout(() => {
      void refetch({ cancelRefetch: false });
    }, Math.min(delay + 250, MAX_TIMEOUT_MS));
    return () => window.clearTimeout(timeoutId);
  }, [loadedForms, dataUpdatedAt, refetch]);

  const fallbackActiveFormsCount = filteredForms.filter((form) => !isTemplateForm(form) && form.is_public).length;
  const fallbackDeadlineFormsCount = filteredForms.filter((form) => !isTemplateForm(form) && Boolean(form.deadline_at)).length;

  return {
    activeFormsCount: formsStats ? formsStats.activeCount : fallbackActiveFormsCount,
    formsStatsQueryKey,
    reloadStats: refetch,
    statsError: error,
    formsWithDeadlineCount: formsStats ? formsStats.formsWithDeadlineCount : fallbackDeadlineFormsCount,
    totalFormsCount: formsStats ? formsStats.totalCount : Math.max(loadedFormsTotalCount, filteredForms.length),
  };
}
