import { useEffect } from "react";
import { useToast } from "../../../app/providers/ToastProvider";
import { createRealtimeRecovery } from "../../../shared/lib/realtimeRecovery";
import type { InfiniteData, QueryKey, QueryClient } from "@tanstack/react-query";
import type { PaginatedSurveyFormSummaries, SurveyFormSummary } from "../../../entities/survey/types";
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

function getCachedDashboardForms(queryClient: QueryClient, formsQueryKey: QueryKey) {
  const cachedData = queryClient.getQueryData<InfiniteData<PaginatedSurveyFormSummaries>>(formsQueryKey);
  const forms = new Map<string, SurveyFormSummary>();

  for (const page of cachedData?.pages ?? []) {
    for (const form of page.items) {
      forms.set(form.id, form);
    }
  }

  return forms;
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
  const { showToast } = useToast();
  useEffect(() => {
    if (isAuthLoading || (viewMode === "mine" && !userId)) {
      return;
    }

    const formFilter = viewMode === "mine" && userId ? `author_id=eq.${userId}` : undefined;
    const refresh = createQueryRefreshScheduler(queryClient, `dashboard realtime ${viewMode} forms`, 750);
    const recovery = createRealtimeRecovery(() => refresh.schedule([{ queryKey: formsQueryKey }, { queryKey: formsStatsQueryKey }]), showToast);
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
          const cachedForms = getCachedDashboardForms(queryClient, formsQueryKey);
          const realtimePayload = payload as DashboardRealtimePayload;

          if (!shouldInvalidateDashboardForms({ cachedForms, filters, payload: realtimePayload })) {
            console.info("[realtime] dashboard forms change ignored", {
              eventType: payload.eventType,
              userId: userId ?? null,
              viewMode,
            });
            return;
          }

          const targets = [{ queryKey: formsQueryKey }];

          if (shouldInvalidateDashboardFormStats({ cachedForms, filters, payload: realtimePayload })) {
            targets.push({ queryKey: formsStatsQueryKey });
          }

          refresh.schedule(targets);
        },
      )
      .subscribe((status) => {
        recovery.status(status);
        console.info("[realtime] dashboard forms channel status", {
          status,
          userId: userId ?? null,
          viewMode,
        });
      });

    return () => {
      recovery.dispose();
      refresh.dispose();
      void supabaseClient.removeChannel(channel);
    };
  }, [filters, formsQueryKey, formsStatsQueryKey, isAuthLoading, queryClient, userId, viewMode, showToast]);
}
