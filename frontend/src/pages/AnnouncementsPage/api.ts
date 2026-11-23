import { apiClient } from "../../shared/api/client";
import { runRequest } from "../../shared/api/request";
import { TIMELINE_PAGE_SIZE, timelinePage, type TimelineCursor } from "../../shared/api/timelinePage";

export const statusTabs = [
  { value: "draft", label: "Черновики" },
  { value: "published", label: "Опубликованные" },
  { value: "scheduled", label: "Запланированные" },
  { value: "archived", label: "Архивные" },
] as const;
export type AnnouncementStatus = typeof statusTabs[number]["value"];
export const audienceLabels = { all: "Все пользователи", user: "Только пользователи", admin: "Только администраторы" };
export const displayLabels = { feed: "Только в центре уведомлений", banner: "Баннер и центр уведомлений", modal: "Окно при входе и центр уведомлений" };

export type AnnouncementFields = {
  title: string;
  message: string;
  audience: keyof typeof audienceLabels;
  display_mode: keyof typeof displayLabels;
  require_acknowledgement: boolean;
  action_label: string | null;
  action_url: string | null;
  expires_at: string | null;
};
export type AdminAnnouncement = TimelineCursor & AnnouncementFields & {
  updated_at: string;
  status: AnnouncementStatus;
  publish_at: string | null;
  audience_count: number;
  familiar_count: number;
};
export type Publication = "keep" | "publish" | "schedule";
export type AnnouncementAction = "withdraw" | "duplicate" | "archive";

function rpcError(error: { code: string; message: string }, fallback: string) {
  const localized = ["22023", "42501", "40001"].includes(error.code) && /^[А-ЯЁ]/.test(error.message);
  if (localized) return new Error(error.message);
  if (error.code === "40001") {
    return new Error("Объявление было изменено в другой вкладке. Обновите список и повторите действие.");
  }
  return new Error(fallback);
}

export async function listAnnouncements(status: AnnouncementStatus, cursor?: TimelineCursor, signal?: AbortSignal) {
  const { data, error } = await runRequest("announcements.adminList", (requestSignal) =>
    apiClient.rpc("list_admin_announcements", {
      p_status: status, p_before_at: cursor?.created_at ?? null, p_before_id: cursor?.id ?? null, p_limit: TIMELINE_PAGE_SIZE + 1,
    }).abortSignal(requestSignal), { signal });
  if (error) throw rpcError(error, "Не удалось загрузить объявления.");
  return timelinePage((data ?? []) as AdminAnnouncement[]);
}

export async function saveAnnouncement(row: AdminAnnouncement | null, fields: AnnouncementFields, publication: Publication, publishAt: string | null) {
  const { data, error } = await runRequest("announcements.save", signal =>
    apiClient.rpc("save_announcement", {
      p_id: row?.id ?? null, p_expected_updated_at: row?.updated_at ?? null,
      p_fields: fields, p_publication: publication, p_publish_at: publishAt,
    }).abortSignal(signal));
  if (error) throw rpcError(error, "Не удалось сохранить объявление. Попробуйте ещё раз.");
  return data as string;
}

export async function changeAnnouncement(row: AdminAnnouncement, action: AnnouncementAction) {
  const { data, error } = await runRequest("announcements.change", signal =>
    apiClient.rpc("change_announcement", {
      p_id: row.id, p_expected_updated_at: row.updated_at, p_action: action,
    }).abortSignal(signal));
  if (error) throw rpcError(error, "Не удалось изменить объявление. Обновите список и попробуйте снова.");
  return data as string;
}
