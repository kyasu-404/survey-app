import { useEffect } from "react";
import type { QueryKey, QueryClient } from "@tanstack/react-query";
import { supabaseClient } from "../../../shared/api";
import { scheduleDebouncedQueryInvalidation } from "../../../shared/lib/queryRefresh";
import type { DashboardViewMode } from "../types";

type UseDashboardRealtimeOptions = {
  formsQueryKey: QueryKey;
  formsStatsQueryKey: QueryKey;
  isAuthLoading: boolean;
  queryClient: QueryClient;
  userId?: string;
  viewMode: DashboardViewMode;
};

export function useDashboardRealtime({
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
        () => {
          scheduleDebouncedQueryInvalidation(
            queryClient,
            `dashboard realtime ${viewMode} forms`,
            [{ queryKey: formsQueryKey }, { queryKey: formsStatsQueryKey }],
            750,
          );
        },
      )
      .subscribe((status) => {
        console.info("[realtime] dashboard forms channel status", {
          status,
          userId: userId ?? null,
          viewMode,
        });
      });

    return () => {
      void supabaseClient.removeChannel(channel);
    };
  }, [formsQueryKey, formsStatsQueryKey, isAuthLoading, queryClient, userId, viewMode]);
}
