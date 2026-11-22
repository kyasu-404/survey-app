import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabaseClient } from "../../shared/api/client";
import { createQueryRefreshScheduler } from "../../shared/lib/queryRefresh";
import { getUnreadCount } from "./api";
import { notificationKey } from "./model";

export function useUnreadCount(userId?: string) {
  return useQuery({
    queryKey: [...notificationKey(userId), "unread-count"],
    queryFn: ({ signal }) => getUnreadCount(signal),
    enabled: Boolean(userId),
    refetchInterval: 60_000,
    staleTime: 20_000,
    retry: false,
  });
}

export function useLiveNotifications(userId?: string) {
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!userId) return;
    const refresh = createQueryRefreshScheduler(queryClient, "personal notifications", 200);
    const invalidate = () => refresh.schedule([{ queryKey: notificationKey(userId) }]);
    const target = { schema: "public", table: "notifications", filter: "user_id=eq." + userId };
    const channel = supabaseClient.channel("personal-notifications:" + userId)
      .on("postgres_changes", { ...target, event: "INSERT" }, invalidate)
      .on("postgres_changes", { ...target, event: "UPDATE" }, invalidate)
      .subscribe((status) => { if (status === "SUBSCRIBED") invalidate(); });
    return () => {
      refresh.dispose();
      void supabaseClient.removeChannel(channel);
    };
  }, [queryClient, userId]);
}
