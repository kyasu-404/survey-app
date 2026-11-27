import { apiClient } from "../../shared/api/client";
import { runRequest } from "../../shared/api/request";
import { TIMELINE_PAGE_SIZE, timelinePage, type TimelineCursor } from "../../shared/api/timelinePage";
import type {
  Notification, NotificationCategory, NotificationFeedItem, NotificationReadFilter, PreferenceCategory, ResponseNotificationGroupKey,
} from "./model";

const notificationTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

export async function getNotifications(
  category: NotificationCategory | "", read: NotificationReadFilter, cursor?: TimelineCursor, signal?: AbortSignal,
) {
  const { data, error } = await runRequest("notifications.list", (requestSignal) => apiClient.rpc("list_notification_feed", {
    p_category: category || null,
    p_read: read,
    p_before_at: cursor?.created_at ?? null,
    p_before_id: cursor?.id ?? null,
    p_limit: TIMELINE_PAGE_SIZE + 1,
    p_timezone: notificationTimeZone,
  }).abortSignal(requestSignal), { signal });
  if (error) throw new Error("Не удалось загрузить уведомления");
  return timelinePage((data ?? []) as NotificationFeedItem[]);
}

export async function getNotificationGroupItems(
  group: ResponseNotificationGroupKey, read: NotificationReadFilter, cursor?: TimelineCursor, signal?: AbortSignal,
) {
  const { data, error } = await runRequest("notifications.group", requestSignal => apiClient.rpc("list_notification_group_items", {
    p_category: group.category,
    p_form_id: group.formId,
    p_day: group.day,
    p_read: read,
    p_timezone: notificationTimeZone,
    p_before_at: cursor?.created_at ?? null,
    p_before_id: cursor?.id ?? null,
    p_limit: TIMELINE_PAGE_SIZE + 1,
  }).abortSignal(requestSignal), { signal });
  if (error) throw new Error("Не удалось загрузить уведомления группы");
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

async function mutateNotification(userId: string, rpc: string, args: Record<string, unknown>, errorMessage: string) {
  const { data: { session }, error: sessionError } = await runRequest("auth.getSession", () => apiClient.auth.getCurrentSession());
  if (sessionError || session?.user.id !== userId || !session.access_token) {
    throw new Error("Сессия аккаунта изменилась");
  }

  // A different tab can replace the session in storage between this check and fetch.
  const { data, error } = await runRequest(`notifications.${rpc}`, signal =>
    apiClient.rpc(rpc, args).setHeader("Authorization", `Bearer ${session.access_token}`).abortSignal(signal));
  if (error) throw new Error(errorMessage);
  return data;
}

export async function deleteNotification(userId: string, id: string): Promise<string | null> {
  const data = await mutateNotification(userId, "delete_notification", { p_id: id }, "Не удалось удалить уведомление");
  return typeof data === "string" ? data : null;
}

export async function restoreNotification(userId: string, id: string, deletedAt: string): Promise<boolean> {
  return await mutateNotification(userId, "restore_notification", { p_id: id, p_deleted_at: deletedAt },
    "Не удалось восстановить уведомление") === true;
}

export async function deleteReadNotifications(userId: string, category: PreferenceCategory | null) {
  const data = await mutateNotification(userId, "delete_read_notifications", { p_category: category },
    "Не удалось удалить прочитанные уведомления");
  return Number(data ?? 0);
}

export async function hideAnnouncement(userId: string, id: string): Promise<boolean> {
  return await mutateNotification(userId, "hide_announcement", { p_id: id }, "Не удалось скрыть объявление") === true;
}

export async function getNotificationPreferences(userId: string, signal?: AbortSignal): Promise<PreferenceCategory[]> {
  const { data, error } = await runRequest("notifications.preferences", (requestSignal) => apiClient.from("notification_preferences")
    .select("muted_categories").eq("user_id", userId).abortSignal(requestSignal).maybeSingle(), { signal });
  if (error) throw new Error("Не удалось загрузить настройки уведомлений");
  return (data?.muted_categories ?? ["response_received"]) as PreferenceCategory[];
}

export async function saveNotificationPreferences(muted: PreferenceCategory[]) {
  const { error } = await runRequest("notifications.savePreferences", (signal) =>
    apiClient.rpc("save_notification_preferences", { p_muted_categories: muted }).abortSignal(signal));
  if (error) throw new Error("Не удалось сохранить настройки уведомлений");
}
