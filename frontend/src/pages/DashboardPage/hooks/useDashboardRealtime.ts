import { useEffect } from "react";
import type { InfiniteData, QueryKey, QueryClient } from "@tanstack/react-query";
import type { PaginatedSurveyFormSummaries } from "../../../entities/survey/types";
import { supabaseClient } from "../../../shared/api";
import { createQueryRefreshScheduler } from "../../../shared/lib/queryRefresh";
import type { DashboardListFilters, DashboardViewMode } from "../types";
import {
  shouldInvalidateDashboardForms,
  shouldInvalidateDashboardFormStats,
  type DashboardRealtimePayload,
} from "./dashboardRealtimeFilters";

type UseDashboardRealtimeOptions = {
  filters: DashboardListFilters;
  formsQueryKey: QueryKey;
  formsStatsQueryKey: QueryKey;
  isAuthLoading: boolean;
  queryClient: QueryClient;
  userId?: string;
  viewMode: DashboardViewMode;
};

function getCachedDashboardFormIds(queryClient: QueryClient, formsQueryKey: QueryKey) {
  const cachedData = queryClient.getQueryData<InfiniteData<PaginatedSurveyFormSummaries>>(formsQueryKey);
  const ids = new Set<string>();

  for (const page of cachedData?.pages ?? []) {
    for (const form of page.items) {
      ids.add(form.id);
    }
  }

  return ids;
}

export function useDashboardRealtime({
  filters,
  formsQueryKey,
  formsStatsQueryKey,
  isAuthLoading,
  queryClient,
  userId,
  viewMode,
}: UseDashboardRealtimeOptions) {
  useEffect(() => {
    if (isAuthLoading || (viewMode === "mine" && !userId)) {
      return;
    }

    const formFilter = viewMode === "mine" && userId ? `author_id=eq.${userId}` : undefined;
    const refresh = createQueryRefreshScheduler(queryClient, `dashboard realtime ${viewMode} forms`, 750);
    const channel = supabaseClient
      .channel(`dashboard-forms:${viewMode}:${userId ?? "all"}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "forms",
          ...(formFilter ? { filter: formFilter } : {}),
        },
        (payload) => {
          const cachedFormIds = getCachedDashboardFormIds(queryClient, formsQueryKey);
          const realtimePayload = payload as DashboardRealtimePayload;

          if (!shouldInvalidateDashboardForms({ cachedFormIds, filters, payload: realtimePayload })) {
            console.info("[realtime] dashboard forms change ignored", {
              eventType: payload.eventType,
              userId: userId ?? null,
              viewMode,
            });
            return;
          }

          const targets = [{ queryKey: formsQueryKey }];

          if (shouldInvalidateDashboardFormStats({ cachedFormIds, filters, payload: realtimePayload })) {
            targets.push({ queryKey: formsStatsQueryKey });
          }

          refresh.schedule(targets);
        },
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          refresh.schedule([{ queryKey: formsQueryKey }, { queryKey: formsStatsQueryKey }]);
        }
        console.info("[realtime] dashboard forms channel status", {
          status,
          userId: userId ?? null,
          viewMode,
        });
      });

    return () => {
      refresh.dispose();
      void supabaseClient.removeChannel(channel);
    };
  }, [filters, formsQueryKey, formsStatsQueryKey, isAuthLoading, queryClient, userId, viewMode]);
}
