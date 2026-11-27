import { useRef } from "react";
import { useMutation, useQueryClient, type InfiniteData, type QueryClient } from "@tanstack/react-query";
import { createAuthCacheGuard } from "../../app/providers/authCache";
import { useToast } from "../../app/providers/ToastProvider";
import {
  acknowledgeAnnouncement, deleteNotification, deleteReadNotifications, getNotifications, hideAnnouncement,
  markNotificationsRead, restoreNotification,
} from "./api";
import { isGroupedResponseNotification, notificationKey, type Notification, type PreferenceCategory } from "./model";
import { broadcastAnnouncementHide, dispatchNotificationStatus } from "./useNotifications";

function refreshStatus(queryClient: QueryClient, userId: string) {
  dispatchNotificationStatus(userId);
  void queryClient.invalidateQueries({ queryKey: notificationKey(userId) });
}

export function useNotificationActions(userId: string) {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const refresh = () => refreshStatus(queryClient, userId);
  const mark = useMutation({
    mutationFn: markNotificationsRead,
    onSuccess: refresh,
    onError: () => showToast("Не удалось отметить уведомления прочитанными", "error"),
  });
  const acknowledge = useMutation({
    mutationFn: acknowledgeAnnouncement,
    onSuccess: refresh,
    onError: () => showToast("Не удалось подтвердить ознакомление", "error"),
  });
  return { mark, acknowledge };
}

type Removal =
  | { kind: "delete" | "hide"; item: Notification; onRemoveFocus: () => HTMLElement | undefined }
  | { kind: "bulk"; category: PreferenceCategory | null };

const removalErrors = {
  delete: "Не удалось удалить уведомление",
  hide: "Не удалось скрыть объявление",
  bulk: "Не удалось удалить прочитанные уведомления",
};

type FeedData = InfiniteData<Awaited<ReturnType<typeof getNotifications>>>;

export function useNotificationRemoval(userId: string) {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const userKey = notificationKey(userId);
  const feedKey = [...userKey, "list"];
  const unreadKey = [...userKey, "unread-count"];
  const locked = useRef(false);
  const mutation = useMutation({
    networkMode: "always",
    mutationFn: async ({ request, isCurrentUser }: { request: Removal; isCurrentUser: () => boolean }) => {
      if (!isCurrentUser()) return;
      const countUpdates = queryClient.getQueryState(unreadKey)?.dataUpdateCount;
      const matches = (item: Notification) => request.kind === "bulk"
        ? Boolean(item.read_at) && item.category !== "announcement" && (!request.category || item.category === request.category)
        : item.id === request.item.id && item.category === request.item.category;
      try {
        let deletedAt: string | null = null;
        let removedCount = 1;
        if (request.kind === "bulk") {
          removedCount = await deleteReadNotifications(userId, request.category);
        } else if (request.kind === "hide") {
          if (!await hideAnnouncement(userId, request.item.id)) throw new Error(removalErrors.hide);
        } else {
          deletedAt = await deleteNotification(userId, request.item.id);
          if (!deletedAt) throw new Error(removalErrors.delete);
        }
        if (!isCurrentUser()) return;

        // Prevent an in-flight list/count request from overwriting the just-committed removal.
        await queryClient.cancelQueries({ queryKey: userKey });
        if (!isCurrentUser()) return;
        const focusFrom = request.kind === "bulk" ? undefined : request.onRemoveFocus();
        let hadUnread = false;
        queryClient.setQueriesData<FeedData>({ queryKey: feedKey }, data => data && ({
          ...data,
          pages: data.pages.map(page => ({
            ...page,
            items: page.items.filter(item => {
              // Group totals and their latest item are reconciled by the feed request.
              if (isGroupedResponseNotification(item) || !matches(item)) return true;
              hadUnread ||= !item.read_at;
              return false;
            }),
          })),
        }));
        if (hadUnread && countUpdates === queryClient.getQueryState(unreadKey)?.dataUpdateCount) {
          queryClient.setQueryData<number>(unreadKey, count => count === undefined ? count : Math.max(0, count - 1));
        }

        if (request.kind === "bulk") {
          showToast(removedCount ? `Удалено уведомлений: ${removedCount}` : "Нет прочитанных личных уведомлений", "success");
        } else if (request.kind === "hide") {
          broadcastAnnouncementHide(userId);
          showToast("Объявление скрыто", "success");
        } else if (deletedAt) {
          const token = deletedAt;
          showToast("Уведомление удалено", "success", { durationMs: 10_000, action: {
            label: "Отменить удаление",
            focusFrom,
            run: async () => {
              if (!isCurrentUser()) return true;
              try {
                if (await restoreNotification(userId, request.item.id, token)) return true;
                if (isCurrentUser()) showToast("Уведомление больше нельзя восстановить", "warning");
                return true;
              } catch {
                if (isCurrentUser()) showToast("Не удалось восстановить уведомление", "error");
                return false;
              } finally {
                if (isCurrentUser()) refreshStatus(queryClient, userId);
              }
            },
          } });
        }
      } catch {
        if (isCurrentUser()) showToast(removalErrors[request.kind], "error");
      } finally {
        if (isCurrentUser()) refreshStatus(queryClient, userId);
      }
    },
    onSettled: () => { locked.current = false; },
  });

  return {
    pending: mutation.isPending,
    remove: (request: Removal) => {
      if (locked.current) return;
      locked.current = true;
      mutation.mutate({ request, isCurrentUser: createAuthCacheGuard(queryClient) });
    },
  };
}
