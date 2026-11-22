import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "../../app/providers/ToastProvider";
import { acknowledgeAnnouncement, markNotificationsRead } from "./api";
import { notificationKey } from "./model";

export const notificationStatusEvent = "survey:notification-status";

export function useNotificationActions(userId: string) {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const refresh = () => {
    window.dispatchEvent(new CustomEvent(notificationStatusEvent, { detail: userId }));
    void queryClient.invalidateQueries({ queryKey: notificationKey(userId) });
  };
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
