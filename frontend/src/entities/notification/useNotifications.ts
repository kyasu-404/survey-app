import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabaseClient } from "../../shared/api/client";
import { createQueryRefreshScheduler } from "../../shared/lib/queryRefresh";
import { getUnreadCount } from "./api";
import { notificationKey } from "./model";

export const notificationStatusEvent = "survey:notification-status";
const announcementHideSender = Math.random().toString(36);

export function dispatchNotificationStatus(userId: string) {
  window.dispatchEvent(new CustomEvent(notificationStatusEvent, { detail: userId }));
}

function openAnnouncementHideChannel(userId: string) {
  try {
    return typeof BroadcastChannel === "function" ? new BroadcastChannel(`survey:announcement-hidden:${userId}`) : undefined;
  } catch {
    return undefined;
  }
}

export function broadcastAnnouncementHide(userId: string) {
  const channel = openAnnouncementHideChannel(userId);
  try {
    channel?.postMessage(announcementHideSender);
  } catch {
    // Local invalidation still refreshes the tab that performed the hide.
  } finally {
    channel?.close();
  }
}

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
    // Announcement recipient state is private and has no database change subscription.
    const peer = openAnnouncementHideChannel(userId);
    peer?.addEventListener("message", (event) => {
      if (typeof event.data !== "string" || event.data === announcementHideSender) return;
      dispatchNotificationStatus(userId);
      invalidate();
    });
    const target = { schema: "public", table: "notifications", filter: "user_id=eq." + userId };
    const channel = supabaseClient.channel("personal-notifications:" + userId)
      .on("postgres_changes", { ...target, event: "INSERT" }, invalidate)
      .on("postgres_changes", { ...target, event: "UPDATE" }, invalidate)
      .subscribe((status) => { if (status === "SUBSCRIBED") invalidate(); });
    return () => {
      peer?.close();
      refresh.dispose();
      void supabaseClient.removeChannel(channel);
    };
  }, [queryClient, userId]);
}
