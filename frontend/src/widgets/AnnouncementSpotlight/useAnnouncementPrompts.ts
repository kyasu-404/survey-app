import { useCallback, useEffect, useRef, useState } from "react";
import { claimAnnouncementPrompt, listAnnouncementPrompts, type AnnouncementPrompt } from "../../entities/announcement/promptApi";
import { notificationStatusEvent } from "../../entities/notification/useNotificationActions";

const openDialogSelector = 'dialog[open], [role="dialog"][aria-modal="true"]';

function isEligible(prompt: AnnouncementPrompt) {
  const expired = prompt.expires_at && Date.parse(prompt.expires_at) <= Date.now();
  return !expired && !prompt.acknowledged_at && (!prompt.read_at || prompt.require_acknowledgement);
}

export function useAnnouncementPrompts(userId: string) {
  const [prompts, setPrompts] = useState<AnnouncementPrompt[]>([]);
  const visible = useRef<AnnouncementPrompt[]>([]);
  const entryModalId = useRef<string | null>();
  const update = useCallback((next: AnnouncementPrompt[]) => {
    visible.current = next;
    setPrompts(next);
  }, []);
  const dismiss = useCallback((id: string) => {
    update(visible.current.filter(item => item.id !== id));
  }, [update]);

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    let busy = false;
    let refreshRequested = false;
    let timer: number;
    // A read can be cancelled safely. Only claim after a fresh audience check while this session is active.
    async function refresh() {
      if (signal.aborted || document.hidden) return;
      if (busy) { refreshRequested = true; return; }
      busy = true;
      window.clearTimeout(timer);
      try {
        const rows = await listAnnouncementPrompts(visible.current.map(item => item.id), signal);
        if (signal.aborted || document.hidden) return;
        const eligible = rows.filter(isEligible);
        const next = visible.current.flatMap(item => eligible.filter(row => row.id === item.id && row.display_mode === item.display_mode));
        if (next.length || visible.current.length) update(next);
        if (entryModalId.current === undefined) {
          entryModalId.current = document.querySelector(openDialogSelector) ? null :
            eligible.find(row => row.display_mode === "modal" && !row.presented_at)?.id ?? null;
        }
        for (const row of eligible) {
          if (row.presented_at || visible.current.some(item => item.display_mode === row.display_mode)) continue;
          if (row.display_mode === "modal" && (row.id !== entryModalId.current || document.querySelector(openDialogSelector))) continue;
          if (signal.aborted || document.hidden) break;
          if (await claimAnnouncementPrompt(row, signal) && !signal.aborted && isEligible(row)) {
            update([...visible.current, row]);
            if (row.display_mode === "modal") entryModalId.current = null;
          }
        }
      } catch {
        // The center reports feed errors. Retry supplemental displays on focus and the next poll.
      } finally {
        busy = false;
        if (!signal.aborted) {
          timer = window.setTimeout(refresh, refreshRequested ? 0 : visible.current.length ? 15_000 : 60_000);
          refreshRequested = false;
        }
      }
    }
    const onStatusChange = (event: Event) => {
      if ((event as CustomEvent<string>).detail === userId) void refresh();
    };
    void refresh();
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener(notificationStatusEvent, onStatusChange);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener(notificationStatusEvent, onStatusChange);
    };
  }, [userId, update]);

  useEffect(() => {
    const expiries = prompts.flatMap(item => item.expires_at ? [Date.parse(item.expires_at)] : []);
    if (!expiries.length) return;
    const delay = Math.max(0, Math.min(...expiries) - Date.now());
    const timer = window.setTimeout(() => update(visible.current.filter(isEligible)), Math.min(delay, 2_147_483_647));
    return () => window.clearTimeout(timer);
  }, [prompts, update]);

  return { prompts, dismiss };
}
