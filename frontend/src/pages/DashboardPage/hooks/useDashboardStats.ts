import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { getDashboardFormsStats } from "../../../entities/survey/api/surveysApi";
import { getDashboardFormStatsQueryKey } from "../../../entities/survey/model/queryKeys";
import { isTemplateForm } from "../../../entities/survey/model/surveyModel";
import type { SurveyFormSummary } from "../../../entities/survey/types";
import type { DashboardListFilters, DashboardViewMode } from "../types";

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
  filters: DashboardFilterState;
  isAuthLoading: boolean;
  loadedFormsTotalCount: number;
  userId?: string;
  viewMode: DashboardViewMode;
};

export function useDashboardStats({
  filteredForms,
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

  const { data: formsStats } = useQuery({
    queryKey: formsStatsQueryKey,
    queryFn: ({ signal }) => getDashboardFormsStats(filters.listFilters, { signal }),
    enabled: !isAuthLoading && (viewMode === "all" || Boolean(userId)),
    retry: 1,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: true,
  });

  const fallbackActiveFormsCount = filteredForms.filter((form) => !isTemplateForm(form) && form.is_public).length;
  const fallbackDeadlineFormsCount = filteredForms.filter((form) => !isTemplateForm(form) && Boolean(form.deadline_at)).length;

  return {
    activeFormsCount: formsStats ? formsStats.activeCount : fallbackActiveFormsCount,
    formsStatsQueryKey,
    formsWithDeadlineCount: formsStats ? formsStats.formsWithDeadlineCount : fallbackDeadlineFormsCount,
    totalFormsCount: formsStats ? formsStats.totalCount : Math.max(loadedFormsTotalCount, filteredForms.length),
  };
}
