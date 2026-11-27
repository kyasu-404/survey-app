export const preferenceCategories = {
  response_received: "Новые ответы",
  response_updated: "Изменения ответов",
  automation_failed: "Ошибки автоматизации",
  form_status: "Состояние форм",
} as const;

export const notificationCategories = { ...preferenceCategories, announcement: "Объявления" } as const;
export type PreferenceCategory = keyof typeof preferenceCategories;
export type NotificationCategory = keyof typeof notificationCategories;
export type NotificationReadFilter = "all" | "unread" | "read";

export type AnnouncementDetails = {
  action_label: string | null;
  action_url: string | null;
  require_acknowledgement: boolean;
  acknowledged_at: string | null;
  display_mode: "feed" | "banner" | "modal";
};

export type Notification = {
  id: string;
  category: NotificationCategory;
  title: string;
  message: string;
  form_id: string | null;
  response_id: string | null;
  rule_id: string | null;
  created_at: string;
  read_at: string | null;
  announcement: AnnouncementDetails | null;
};

type ResponseNotificationCategory = "response_received" | "response_updated";

type ResponseGroupSummary = {
  day: string;
  count: number;
  unread_count: number;
};

export type NotificationFeedItem = Notification & {
  response_group?: ResponseGroupSummary | null;
};

export type GroupedResponseNotification = Notification & {
  category: ResponseNotificationCategory;
  form_id: string;
  response_group: ResponseGroupSummary;
};

export type ResponseNotificationGroupKey = {
  category: ResponseNotificationCategory;
  formId: string;
  day: string;
};

export function isGroupedResponseNotification(item: NotificationFeedItem): item is GroupedResponseNotification {
  return (item.category === "response_received" || item.category === "response_updated")
    && Boolean(item.form_id && item.response_group && item.response_group.count > 1);
}

export function notificationFeedItemKey(item: NotificationFeedItem) {
  return item.response_group
    ? `response-group:${item.category}:${item.form_id}:${item.response_group.day}`
    : item.id;
}

export const notificationKey = (userId?: string) => ["notifications", userId] as const;
export const notificationPreferencesKey = (userId?: string) => ["notification-preferences", userId] as const;
