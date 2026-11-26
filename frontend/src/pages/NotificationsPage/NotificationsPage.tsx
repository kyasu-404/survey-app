import { ModalHeading } from "../../shared/ui/ModalHeading";
import { useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { routes } from "../../app/routes";
import { useAuth } from "../../app/providers/AuthProvider";
import { AnnouncementAction, AnnouncementContent } from "../../entities/announcement/AnnouncementContent";
import { NotificationCard } from "../../entities/notification/NotificationCard";
import { getNotifications } from "../../entities/notification/api";
import { NotificationPreferences } from "../../entities/notification/NotificationPreferences";
import { notificationCategories, notificationKey, type NotificationCategory, type NotificationReadFilter } from "../../entities/notification/model";
import { useNotificationActions } from "../../entities/notification/useNotificationActions";
import { useUnreadCount } from "../../entities/notification/useNotifications";
import { useTimelineHeadRefresh } from "../../shared/api/useTimelineHeadRefresh";
import type { TimelineCursor } from "../../shared/api/timelinePage";
import { Icon } from "../../shared/ui/Icon";
import { Skeleton } from "../../shared/ui/Skeleton";
import { useModalSurface } from "../../shared/ui/useModalSurface";
import "./notifications.css";

function PreferencesDialog({ userId, onClose }: { userId: string; onClose: () => void }) {
  const dialog = useModalSurface();
  return <dialog ref={dialog} aria-labelledby="notification-settings-title" className="card modal-card notification-preferences-dialog"
    onCancel={event => { event.preventDefault(); onClose(); }}>
    <ModalHeading className="activity-heading" onClose={onClose} label="Закрыть настройки">
      <h2 id="notification-settings-title">Настройки уведомлений</h2>
    </ModalHeading>
    <NotificationPreferences userId={userId} onSaved={onClose} />
  </dialog>;
}

export default function NotificationsPage() {
  const { user } = useAuth();
  return user ? <NotificationCenter key={user.id} userId={user.id} /> : null;
}

function NotificationCenter({ userId }: { userId: string }) {
  const [category, setCategory] = useState<NotificationCategory | "">("");
  const [read, setRead] = useState<NotificationReadFilter>("all");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const unread = useUnreadCount(userId);
  const queryKey = [...notificationKey(userId), "list", category, read];
  const feed = useInfiniteQuery({
    queryKey,
    initialPageParam: undefined as TimelineCursor | undefined,
    queryFn: ({ pageParam, signal }) => getNotifications(category, read, pageParam, signal),
    getNextPageParam: (last) => last.next,
    refetchOnMount: "always",
    refetchInterval: ({ state }) => (state.data?.pages.length ?? 0) <= 1 ? 30_000 : false,
  });
  useTimelineHeadRefresh({
    queryKey, pageCount: feed.data?.pages.length ?? 0, interval: 30_000,
    fetchPage: signal => getNotifications(category, read, undefined, signal),
  });
  const { mark, acknowledge } = useNotificationActions(userId);
  const items = feed.data?.pages.flatMap((page) => page.items) ?? [];
  const filtered = Boolean(category || read !== "all");

  return (
    <div className="dashboard-page">
      <section className="activity-page notification-center">
        <header className="activity-heading">
          <div>
            <h1>Уведомления</h1>
            {unread.data !== undefined && <p aria-live="polite">Непрочитанных: {unread.data}</p>}
          </div>
          <div className="activity-actions">
            {(feed.data?.pages.length ?? 0) > 1 && <button type="button" className="app-button"
              disabled={feed.isFetching} onClick={() => void feed.refetch()}>Обновить ленту</button>}
            <button type="button" className="app-button" aria-haspopup="dialog" onClick={() => setSettingsOpen(true)}>
              <Icon name="settings" /> Настроить
            </button>
            <button type="button" className="app-button" disabled={!unread.data || unread.isError || mark.isPending} onClick={() => mark.mutate(null)}>
              Отметить все прочитанными
            </button>
          </div>
        </header>

        <div className="activity-toolbar">
          <label className="activity-field">Категория
            <select value={category} onChange={(event) => setCategory(event.target.value as NotificationCategory | "")}>
              <option value="">Все категории</option>
              {Object.entries(notificationCategories).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
            </select>
          </label>
          <label className="activity-field">Статус
            <select value={read} onChange={(event) => setRead(event.target.value as NotificationReadFilter)}>
              <option value="all">Все уведомления</option>
              <option value="unread">Непрочитанные</option>
              <option value="read">Прочитанные</option>
            </select>
          </label>
        </div>

        {feed.isPending && <Skeleton className="activity-skeleton" />}
        {feed.isError && !feed.isFetchNextPageError && <div role="alert" className="activity-state">
          <p>Не удалось загрузить уведомления.</p>
          <button type="button" className="app-button" onClick={() => void feed.refetch()}>Повторить</button>
        </div>}
        {feed.isSuccess && !items.length && <div className="activity-state notification-empty">
          <span className="notification-empty-icon"><Icon name={filtered ? "filter_list" : "notifications"} size={24} /></span>
          <h2>{filtered ? "По выбранным фильтрам ничего нет" : "Уведомлений пока нет"}</h2>
          <p>{filtered ? "Вы можете просмотреть события других категорий и статусов." :
            "Здесь появятся события по вашим формам, автоматизациям и объявления администрации."}</p>
          {filtered && <button className="app-button" type="button" onClick={() => { setCategory(""); setRead("all"); }}>Сбросить фильтры</button>}
        </div>}
        {items.length > 0 && <ul className="notification-grid" role="list" aria-label="Лента уведомлений">
          {items.map((item) => {
            const details = item.announcement;
            const markRead = () => { if (!item.read_at) mark.mutate(item.id); };
            const hasActions = item.form_id || item.rule_id || details?.action_url || details?.require_acknowledgement;
            const actions = hasActions && <>
              {details && <AnnouncementAction actionLabel={details.action_label} actionUrl={details.action_url} onAction={markRead} />}
              {item.form_id && (item.response_id
                ? <Link to={routes.formResponse(item.form_id, item.response_id)} onClick={markRead}>Открыть ответ</Link>
                : <Link to={routes.builderEdit(item.form_id)} onClick={markRead}>Открыть форму</Link>)}
              {item.rule_id && <Link to={routes.automation(item.rule_id)} onClick={markRead}>Открыть правило</Link>}
              {details?.require_acknowledgement && (details.acknowledged_at
                ? <span className="notification-acknowledged"><Icon name="check_circle" size={16} /> Ознакомление подтверждено</span>
                : <button type="button" className="app-button" disabled={acknowledge.isPending}
                  onClick={() => acknowledge.mutate(item.id)}>Ознакомился</button>)}
            </>;
            return <li key={item.id}>
              <NotificationCard category={item.category} title={item.title} createdAt={item.created_at}
                unread={!item.read_at} markPending={mark.isPending} onMarkRead={markRead} actions={actions}>
                {details ? <AnnouncementContent message={item.message} /> : <p>{item.message}</p>}
              </NotificationCard>
            </li>;
          })}
        </ul>}
        {feed.isFetchNextPageError && <div role="alert" className="activity-state">
          <p>Не удалось загрузить следующие уведомления.</p>
          <button type="button" className="app-button" disabled={feed.isFetching} onClick={() => void feed.fetchNextPage()}>Повторить</button>
        </div>}
        {feed.hasNextPage && !feed.isFetchNextPageError && <button type="button" className="app-button activity-more" disabled={feed.isFetching}
          onClick={() => void feed.fetchNextPage()}>Показать ещё</button>}
      </section>
      {settingsOpen && <PreferencesDialog userId={userId} onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}
