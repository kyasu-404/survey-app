import { useState } from "react";
import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../../app/providers/AuthProvider";
import { useToast } from "../../app/providers/ToastProvider";
import { notificationKey } from "../../entities/notification/model";
import type { TimelineCursor } from "../../shared/api/timelinePage";
import { getErrorMessage } from "../../shared/lib/error";
import { Icon } from "../../shared/ui/Icon";
import { SectionTabs } from "../../shared/ui/SectionTabs";
import { Skeleton } from "../../shared/ui/Skeleton";
import { useModalSurface } from "../../shared/ui/useModalSurface";
import { AnnouncementEditor } from "./AnnouncementEditor";
import { AnnouncementRow } from "./AnnouncementRow";
import { changeAnnouncement, listAnnouncements, statusTabs, type AdminAnnouncement, type AnnouncementAction, type AnnouncementStatus } from "./api";
import "./announcements.css";

const messages = {
  withdraw: "Объявление возвращено в черновики.",
  duplicate: "Копия сохранена в черновиках.",
  archive: "Объявление перенесено в архив.",
};
const emptyText = {
  draft: "Здесь появятся объявления, которые вы сохраните как черновики.",
  published: "Сейчас опубликованных объявлений нет.",
  scheduled: "Объявлений с будущей датой публикации пока нет.",
  archived: "Здесь появятся архивные объявления и объявления с истёкшим сроком действия.",
};

function ArchiveDialog({ row, onConfirm, onCancel }: { row: AdminAnnouncement; onConfirm: () => void; onCancel: () => void }) {
  const dialog = useModalSurface();
  return <dialog ref={dialog} className="card modal-card activity-rule-dialog announcement-archive-dialog"
    aria-labelledby="archive-title" onCancel={event => { event.preventDefault(); onCancel(); }}>
    <h2 id="archive-title">Архивировать объявление?</h2>
    <p>«{row.title}» будет доступно администраторам в архиве. Для новой публикации можно будет создать копию.</p>
    <div className="activity-actions activity-dialog-actions">
      <button className="app-button" type="button" onClick={onCancel}>Отмена</button>
      <button className="button-primary" type="button" onClick={onConfirm}>Архивировать</button>
    </div>
  </dialog>;
}

export default function AnnouncementsPage() {
  const userId = useAuth().user!.id;
  const client = useQueryClient();
  const { showToast } = useToast();
  const [status, setStatus] = useState<AnnouncementStatus>("draft");
  const [editor, setEditor] = useState<AdminAnnouncement | "new" | null>(null);
  const [archive, setArchive] = useState<AdminAnnouncement | null>(null);
  const key = ["admin-announcements", userId];
  const list = useInfiniteQuery({
    queryKey: [...key, status],
    initialPageParam: undefined as TimelineCursor | undefined,
    queryFn: ({ pageParam, signal }) => listAnnouncements(status, pageParam, signal),
    getNextPageParam: last => last.next,
    refetchOnMount: true,
    refetchInterval: 20_000,
  });

  function refresh() {
    void client.invalidateQueries({ queryKey: key });
    void client.invalidateQueries({ queryKey: notificationKey(userId) });
  }
  function finish(next: AnnouncementStatus, message: string) {
    setEditor(null);
    setStatus(next);
    refresh();
    showToast(message, "success");
  }
  const change = useMutation({
    mutationFn: ({ row, action }: { row: AdminAnnouncement; action: AnnouncementAction }) => changeAnnouncement(row, action),
    onSuccess: (_id, { action }) => finish(action === "archive" ? "archived" : "draft", messages[action]),
    onError: error => {
      refresh();
      showToast(getErrorMessage(error, "Не удалось изменить объявление."), "error");
    },
  });
  const rows = list.data?.pages.flatMap(page => page.items) ?? [];
  return <div className="dashboard-page">
    <section className="card activity-page announcement-admin">
      <header className="activity-heading">
        <div><h1>Объявления</h1><p>Сообщения администрации для пользователей приложения.</p></div>
        <button className="button-primary" type="button" disabled={change.isPending} onClick={() => setEditor("new")}>
          <Icon name="add" size={18} /> Создать объявление
        </button>
      </header>
      <SectionTabs id="admin-announcements" label="Статус объявления" tabs={statusTabs} value={status} onChange={setStatus} />
      <div role="tabpanel" id={"admin-announcements-panel-" + status} aria-labelledby={"admin-announcements-tab-" + status} className="announcement-admin-panel">
        {list.isPending && <div role="status" aria-label="Загрузка объявлений"><Skeleton className="activity-skeleton" /></div>}
        {list.isError && <div role="alert" className="activity-state">
          <p>{getErrorMessage(list.error, "Не удалось загрузить объявления.")}</p>
          <button type="button" className="app-button" onClick={() => void list.refetch()}>Повторить</button>
        </div>}
        {list.isSuccess && !rows.length && <p className="activity-state">{emptyText[status]}</p>}
        {rows.length > 0 && <ul className="activity-list">{rows.map(row => <AnnouncementRow key={row.id} row={row}
          disabled={change.isPending} busy={change.isPending && change.variables.row.id === row.id}
          onEdit={() => setEditor(row)} onChange={action => {
            if (action === "archive") setArchive(row);
            else change.mutate({ row, action });
          }} />)}</ul>}
        {list.hasNextPage && <button type="button" className="app-button activity-more" disabled={list.isFetching}
          onClick={() => void list.fetchNextPage()}>{list.isFetchingNextPage ? "Загрузка…" : "Показать ещё"}</button>}
      </div>
    </section>
    {editor && <AnnouncementEditor row={editor === "new" ? null : editor} onClose={() => setEditor(null)} onSaved={finish} onSaveError={refresh} />}
    {archive && <ArchiveDialog row={archive} onCancel={() => setArchive(null)} onConfirm={() => {
      change.mutate({ row: archive, action: "archive" }); setArchive(null);
    }} />}
  </div>;
}
