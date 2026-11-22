import { apiClient } from "../../shared/api/client";
import { runRequest } from "../../shared/api/request";
import type { AnnouncementDetails } from "../notification/model";

export type AnnouncementPrompt = AnnouncementDetails & {
  id: string;
  title: string;
  message: string;
  display_mode: "banner" | "modal";
  read_at: string | null;
  expires_at: string | null;
  presented_at: string | null;
};

export async function listAnnouncementPrompts(visibleIds: string[], signal: AbortSignal) {
  const { data, error } = await runRequest("announcements.prompts", requestSignal =>
    apiClient.rpc("list_announcement_prompts", { p_visible_ids: visibleIds }).abortSignal(requestSignal), { signal });
  if (error) throw new Error("Не удалось загрузить объявления");
  return (data ?? []) as AnnouncementPrompt[];
}

export async function claimAnnouncementPrompt(prompt: AnnouncementPrompt, signal: AbortSignal) {
  const { data, error } = await runRequest("announcements.present", requestSignal =>
    apiClient.rpc("claim_announcement_prompt", { p_id: prompt.id, p_mode: prompt.display_mode }).abortSignal(requestSignal), { signal });
  if (error) throw new Error("Не удалось открыть объявление");
  return data === true;
}
