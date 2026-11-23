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

export const notificationKey = (userId?: string) => ["notifications", userId] as const;
export const notificationPreferencesKey = (userId?: string) => ["notification-preferences", userId] as const;
