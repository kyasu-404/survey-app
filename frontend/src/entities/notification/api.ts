import { apiClient } from "../../shared/api/client";
import { runRequest } from "../../shared/api/request";
import { TIMELINE_PAGE_SIZE, timelinePage, type TimelineCursor } from "../../shared/api/timelinePage";
import type { Notification, NotificationCategory, NotificationReadFilter, PreferenceCategory } from "./model";

export async function getNotifications(
  category: NotificationCategory | "", read: NotificationReadFilter, cursor?: TimelineCursor, signal?: AbortSignal,
) {
  const { data, error } = await runRequest("notifications.list", (requestSignal) => apiClient.rpc("list_notification_feed", {
    p_category: category || null,
    p_read: read,
    p_before_at: cursor?.created_at ?? null,
    p_before_id: cursor?.id ?? null,
    p_limit: TIMELINE_PAGE_SIZE + 1,
  }).abortSignal(requestSignal), { signal });
  if (error) throw new Error("Не удалось загрузить уведомления");
  return timelinePage((data ?? []) as Notification[]);
}

export async function getUnreadCount(signal?: AbortSignal) {
  const { data, error } = await runRequest("notifications.count", (requestSignal) =>
    apiClient.rpc("notification_unread_count").abortSignal(requestSignal), { signal });
  if (error) throw new Error("Не удалось получить число уведомлений");
  return Number(data ?? 0);
}

export async function markNotificationsRead(id: string | null) {
  const { error } = await runRequest("notifications.read", (signal) =>
    apiClient.rpc("mark_notifications_read", { p_id: id }).abortSignal(signal));
  if (error) throw new Error("Не удалось отметить уведомления прочитанными");
}

export async function acknowledgeAnnouncement(id: string) {
  const { error } = await runRequest("announcements.acknowledge", (signal) =>
    apiClient.rpc("acknowledge_announcement", { p_id: id }).abortSignal(signal));
  if (error) throw new Error("Не удалось подтвердить ознакомление");
}

export async function getNotificationPreferences(userId: string, signal?: AbortSignal): Promise<PreferenceCategory[]> {
  const { data, error } = await runRequest("notifications.preferences", (requestSignal) => apiClient.from("notification_preferences")
    .select("muted_categories").eq("user_id", userId).abortSignal(requestSignal).maybeSingle(), { signal });
  if (error) throw new Error("Не удалось загрузить настройки уведомлений");
  return (data?.muted_categories ?? []) as PreferenceCategory[];
}

export async function saveNotificationPreferences(muted: PreferenceCategory[]) {
  const { error } = await runRequest("notifications.savePreferences", (signal) =>
    apiClient.rpc("save_notification_preferences", { p_muted_categories: muted }).abortSignal(signal));
  if (error) throw new Error("Не удалось сохранить настройки уведомлений");
}
