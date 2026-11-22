import { useEffect, useRef, useState } from "react";
import { formatActivityTime } from "../../shared/lib/activityTime";
import { MoreHorizontalIcon } from "../../shared/ui/MoreHorizontalIcon";
import { ViewportMenu } from "../../shared/ui/ViewportMenu";
import { InlineSpinner } from "../../shared/ui/InlineSpinner";
import { audienceLabels, type AdminAnnouncement, type AnnouncementAction } from "./api";

const statuses = { draft: "Черновик", published: "Опубликовано", scheduled: "Запланировано", archived: "В архиве" };

export function AnnouncementRow({ row, busy, disabled, onEdit, onChange }: {
  row: AdminAnnouncement; busy: boolean; disabled: boolean; onEdit: () => void; onChange: (action: AnnouncementAction) => void;
}) {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    function outside(event: PointerEvent) {
      if (event.target instanceof Node && !container.current?.contains(event.target)) setOpen(false);
    }
    function escape(event: KeyboardEvent) {
      if (event.key === "Escape") { setOpen(false); anchor.current?.focus(); }
    }
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  function run(action: AnnouncementAction) {
    setOpen(false);
    anchor.current?.focus();
    onChange(action);
  }

  return <li className="activity-row announcement-admin-row">
    <div className="activity-row-body">
      <div className="activity-row-meta">
        <span className={"activity-status" + (row.status === "published" ? " activity-status-succeeded" : "")}>{statuses[row.status]}</span>
        <span>{audienceLabels[row.audience]}</span>
      </div>
      <button type="button" className="announcement-admin-title" onClick={onEdit} disabled={disabled}>{row.title}</button>
      <div className="activity-row-meta">
        {row.publish_at
          ? <span>Публикация <time dateTime={row.publish_at}>{formatActivityTime(row.publish_at)}</time></span>
          : <span>Дата публикации не назначена</span>}
        {row.expires_at && <span>До <time dateTime={row.expires_at}>{formatActivityTime(row.expires_at)}</time></span>}
      </div>
      <dl className="announcement-admin-stats" aria-label="Статистика ознакомления">
        <div><dt>Получателей</dt><dd>{row.audience_count}</dd></div>
        <div><dt>Ознакомились</dt><dd>{row.familiar_count}</dd></div>
        <div><dt>Ещё не ознакомились</dt><dd>{row.audience_count - row.familiar_count}</dd></div>
      </dl>
    </div>
    <div ref={container} className="form-menu" onBlur={event => {
      if (event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget)) setOpen(false);
    }}>
      <button ref={anchor} type="button" className="form-menu-trigger" aria-expanded={open} aria-label={"Действия объявления «" + row.title + "»"}
        onClick={() => setOpen(!open)} disabled={disabled}>{busy ? <InlineSpinner /> : <MoreHorizontalIcon />}</button>
      <ViewportMenu anchor={anchor}>{open && <div className="form-menu-dropdown">
        <button type="button" className="form-menu-item" onClick={() => { setOpen(false); onEdit(); }}>Редактировать</button>
        <button type="button" className="form-menu-item" onClick={() => run("duplicate")}>Дублировать</button>
        {(row.status === "published" || row.status === "scheduled") &&
          <button type="button" className="form-menu-item" onClick={() => run("withdraw")}>
            {row.status === "published" ? "Снять с публикации" : "Вернуть в черновики"}
          </button>}
        {row.status !== "archived" && <button type="button" className="form-menu-item" onClick={() => run("archive")}>Архивировать</button>}
      </div>}</ViewportMenu>
    </div>
  </li>;
}
