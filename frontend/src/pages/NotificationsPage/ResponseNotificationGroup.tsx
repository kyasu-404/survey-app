import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { getNotificationGroupItems } from "../../entities/notification/api";
import { notificationKey, type GroupedResponseNotification, type Notification, type NotificationReadFilter } from "../../entities/notification/model";
import type { TimelineCursor } from "../../shared/api/timelinePage";
import { Icon } from "../../shared/ui/Icon";
import { Skeleton } from "../../shared/ui/Skeleton";

const plural = new Intl.PluralRules("ru");
const dayFormat = new Intl.DateTimeFormat("ru-RU", { dateStyle: "short", timeZone: "UTC" });
const shortDayFormat = new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "2-digit", timeZone: "UTC" });
const eventNames = {
  response_received: { one: "новый ответ", few: "новых ответа", many: "новых ответов" },
  response_updated: { one: "изменение ответа", few: "изменения ответа", many: "изменений ответов" },
};

export function ResponseNotificationGroup({ item, read, userId, renderNotification }: {
  item: GroupedResponseNotification;
  read: NotificationReadFilter;
  userId: string;
  renderNotification: (item: Notification) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const contentId = useId();
  const { day, count, unread_count: unread } = item.response_group;
  const group = { category: item.category, formId: item.form_id, day };
  const members = useInfiniteQuery({
    queryKey: [...notificationKey(userId), "list", "group", group, read],
    initialPageParam: undefined as TimelineCursor | undefined,
    queryFn: ({ pageParam, signal }) => getNotificationGroupItems(group, read, pageParam, signal),
    getNextPageParam: (last) => last.next,
    enabled: open,
    staleTime: 0,
  });
  const { refetch } = members;
  const summaryVersion = `${item.id}:${count}:${unread}`;
  const previousSummary = useRef(summaryVersion);
  useEffect(() => {
    if (previousSummary.current === summaryVersion) return;
    previousSummary.current = summaryVersion;
    // The feed can discover a change through polling without a realtime event.
    if (open) void refetch();
  }, [open, refetch, summaryVersion]);

  const date = new Date(`${day}T00:00:00Z`);
  const dateLabel = dayFormat.format(date);
  const form = plural.select(count);
  const eventName = eventNames[item.category][form === "one" || form === "few" ? form : "many"];
  const title = `${count} ${eventName} · ${item.message.trim() || "Форма"}`;
  const notifications = members.data?.pages.flatMap(page => page.items) ?? [];

  return <div className="notification-card notification-response-group" data-group-unread={unread > 0} data-expanded={open}>
    <button type="button" className="notification-group-toggle" aria-controls={contentId} aria-expanded={open}
      onClick={() => setOpen(current => !current)}>
      <Icon name={item.category === "response_received" ? "notifications" : "edit"} size={20} className="notification-group-icon" />
      <strong className="notification-group-title" title={title}>{title}</strong>
      <span className="notification-group-meta">
        <time dateTime={day} title={dateLabel} aria-label={dateLabel}>
          <span className="notification-group-date">{dateLabel}</span>
          <span className="notification-group-short-date">{shortDayFormat.format(date)}</span>
        </time>
        {unread > 0 && <span className="notification-group-unread" title={`Непрочитанных: ${unread}`}>
          <span className="notification-group-unread-label">Непрочитанных: </span>{unread}
        </span>}
      </span>
      <Icon name={open ? "expand_less" : "expand_more"} size={20} />
    </button>
    <div className="notification-group-content" id={contentId} hidden={!open} aria-busy={open && members.isPending}>
      {open && <>
        {members.isPending && <Skeleton className="activity-skeleton" />}
        {notifications.length > 0 && <ul className="notification-group-items" aria-label={title}>
          {notifications.map(notification => <li key={notification.id}>{renderNotification(notification)}</li>)}
        </ul>}
        {members.isError && <div className="activity-state" role="alert">
          <p>{members.isFetchNextPageError ? "Не удалось загрузить следующие уведомления." : "Не удалось загрузить уведомления группы."}</p>
          <button type="button" className="app-button" disabled={members.isFetching}
            onClick={() => void (members.isFetchNextPageError ? members.fetchNextPage() : members.refetch())}>Повторить</button>
        </div>}
        {members.isSuccess && !notifications.length && <p className="activity-muted">В этой группе больше нет уведомлений.</p>}
        {members.hasNextPage && !members.isFetchNextPageError && <button type="button" className="app-button activity-more"
          disabled={members.isFetching} onClick={() => void members.fetchNextPage()}>Ещё в группе</button>}
      </>}
    </div>
  </div>;
}
