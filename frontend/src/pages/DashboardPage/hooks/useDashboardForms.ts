import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { getDashboardFormsPage } from "../../../entities/survey/api/surveysApi";
import {
  applyDeadlineStatePatch,
  getDeadlineStatePatch,
  getNextDeadlineRefreshDelayMs,
} from "../../../entities/survey/model/deadlineState";
import { getDashboardFormsQueryKey } from "../../../entities/survey/model/queryKeys";
import { isTemplateForm } from "../../../entities/survey/model/surveyModel";
import type { DashboardListFilters, DashboardViewMode } from "../types";
import { DASHBOARD_PAGE_SIZE, MAX_TIMEOUT_MS } from "../dashboardPageConstants";

type DashboardFilterState = {
  dateFrom: string;
  dateTo: string;
  formReason: string;
  formType: string;
  listFilters: DashboardListFilters;
  normalizedSearch: string;
};

type UseDashboardFormsOptions = {
  filters: DashboardFilterState;
  isAuthLoading: boolean;
  userId?: string;
  viewMode: DashboardViewMode;
};

export function useDashboardForms({ filters, isAuthLoading, userId, viewMode }: UseDashboardFormsOptions) {
  const [deadlineReferenceTime, setDeadlineReferenceTime] = useState(() => new Date());
  const pendingLoadMoreScrollPositionRef = useRef<{ left: number; top: number } | null>(null);

  const formsQueryKey = useMemo(
    () =>
      getDashboardFormsQueryKey({
        dateFrom: filters.dateFrom,
        dateTo: filters.dateTo,
        formReason: filters.formReason,
        formType: filters.formType,
        search: filters.normalizedSearch,
        pageSize: DASHBOARD_PAGE_SIZE,
        viewMode,
        userId: userId ?? null,
      }),
    [filters.dateFrom, filters.dateTo, filters.formReason, filters.formType, filters.normalizedSearch, userId, viewMode],
  );

  const query = useInfiniteQuery({
    queryKey: formsQueryKey,
    initialPageParam: 0,
    queryFn: ({ pageParam, signal }) =>
      getDashboardFormsPage({
        page: pageParam,
        pageSize: DASHBOARD_PAGE_SIZE,
        filters: filters.listFilters,
        signal,
      }),
    getNextPageParam: (lastPage, allPages) =>
      lastPage.items.length === DASHBOARD_PAGE_SIZE ? allPages.length : undefined,
    enabled: !isAuthLoading && (viewMode === "all" || Boolean(userId)),
    retry: 1,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: true,
  });

  const loadedForms = useMemo(() => query.data?.pages.flatMap((page) => page.items) ?? [], [query.data]);
  const loadedFormsTotalCount =
    query.data && query.data.pages.length > 0 ? query.data.pages[query.data.pages.length - 1].totalCount : 0;

  const visibleForms = useMemo(() => {
    return loadedForms.map((form) => {
      const deadlineStatePatch = getDeadlineStatePatch(form, deadlineReferenceTime);
      return deadlineStatePatch ? applyDeadlineStatePatch(form, deadlineStatePatch) : form;
    });
  }, [deadlineReferenceTime, loadedForms]);

  const filteredForms = useMemo(() => {
    return visibleForms.filter((form) => !isTemplateForm(form));
  }, [visibleForms]);

  const nextDeadlineRefreshDelayMs = useMemo(
    () => getNextDeadlineRefreshDelayMs(filteredForms, deadlineReferenceTime),
    [deadlineReferenceTime, filteredForms],
  );

  useLayoutEffect(() => {
    const scrollPosition = pendingLoadMoreScrollPositionRef.current;
    if (!scrollPosition || typeof window === "undefined") {
      return;
    }

    pendingLoadMoreScrollPositionRef.current = null;
    window.scrollTo({ ...scrollPosition, behavior: "auto" });
  }, [loadedForms.length]);

  useEffect(() => {
    setDeadlineReferenceTime(new Date());
  }, [query.dataUpdatedAt]);

  useEffect(() => {
    if (nextDeadlineRefreshDelayMs === null) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setDeadlineReferenceTime(new Date());
    }, Math.min(nextDeadlineRefreshDelayMs + 250, MAX_TIMEOUT_MS));

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [nextDeadlineRefreshDelayMs]);

  const handleLoadMoreForms = () => {
    if (!query.hasNextPage || query.isFetchingNextPage) {
      return;
    }

    if (typeof window !== "undefined") {
      pendingLoadMoreScrollPositionRef.current = {
        left: window.scrollX,
        top: window.scrollY,
      };
    }

    void query.fetchNextPage();
  };

  return {
    displayedForms: filteredForms,
    filteredForms,
    formsError: query.error,
    formsQueryKey,
    formsUpdatedAt: query.dataUpdatedAt,
    hasMoreForms: Boolean(query.hasNextPage),
    handleLoadMoreForms,
    isFetchingNextFormsPage: query.isFetchingNextPage,
    isInitialFormsLoading: query.isLoading && loadedForms.length === 0,
    isRefreshingForms: query.isFetching && loadedForms.length > 0 && !query.isFetchingNextPage,
    loadedForms,
    loadedFormsTotalCount,
    reloadForms: query.refetch,
  };
}
