import { useId, useState, type MouseEventHandler, type ReactNode } from "react";
import { formatActivityTime } from "../../shared/lib/activityTime";
import { Icon, type IconName } from "../../shared/ui/Icon";
import { notificationCategories, type NotificationCategory } from "./model";
import "./notificationCard.css";

const categoryIcons: Record<NotificationCategory, IconName> = {
  response_received: "notifications",
  response_updated: "edit",
  automation_failed: "bolt",
  form_status: "description",
  announcement: "info",
};

const shortTime = new Intl.DateTimeFormat("ru-RU", { timeStyle: "short" });

type NotificationCardProps = {
  category: NotificationCategory;
  title: string;
  summary?: string;
  createdAt?: string;
  unread: boolean;
  preview?: boolean;
  markPending?: boolean;
  onMarkRead?: () => void;
  deletePending?: boolean;
  onDelete?: MouseEventHandler<HTMLButtonElement>;
  children: ReactNode;
  actions?: ReactNode;
};

export function NotificationCard({
  category, title, summary, createdAt, unread, preview, markPending, onMarkRead, deletePending, onDelete, children, actions,
}: NotificationCardProps) {
  const [expanded, setExpanded] = useState(Boolean(preview));
  const titleId = useId();
  const detailsId = useId();
  const Heading = preview ? "h4" : "h2";
  const knownCategory = Object.prototype.hasOwnProperty.call(categoryIcons, category);
  const categoryLabel = knownCategory ? notificationCategories[category] : "Уведомление";
  const dateLabel = createdAt ? formatActivityTime(createdAt) : undefined;

  return <article className="notification-card" aria-labelledby={titleId} data-unread={unread}>
    <header className="notification-card-header">
      <Heading className="notification-card-title">
        <button type="button" className="notification-card-toggle" aria-labelledby={titleId}
          aria-expanded={expanded} aria-controls={detailsId} title={title}
          onClick={() => setExpanded(current => !current)}>
          <span className="notification-card-category">
            <Icon name={knownCategory ? categoryIcons[category] : "notifications"} size={18} />
            <span>{categoryLabel}</span>
          </span>
          <span className="notification-card-title-text" id={titleId}>{title}</span>
          {summary && !expanded && <span className="notification-card-summary">{summary}</span>}
          <Icon name={expanded ? "expand_less" : "expand_more"} size={18} className="notification-card-chevron" />
        </button>
      </Heading>
      {(createdAt || unread || onDelete) && <div className="notification-card-meta">
        {createdAt && <time dateTime={createdAt} title={dateLabel} aria-label={dateLabel}>
          <span className="notification-card-date">{dateLabel}</span>
          <span className="notification-card-clock">{dateLabel === "—" ? dateLabel : shortTime.format(new Date(createdAt))}</span>
        </time>}
        {unread && <span className="notification-card-unread" role="img" aria-label="Непрочитанное" />}
        {unread && <button type="button" className="app-button icon-button notification-card-read"
          aria-label="Отметить прочитанным" title="Отметить прочитанным"
          disabled={preview || markPending} onClick={onMarkRead}>
          <Icon name="check_circle" size={18} />
        </button>}
        {onDelete && <button type="button" className="app-button icon-button notification-card-delete"
          aria-label="Удалить уведомление" title="Удалить уведомление" aria-disabled={deletePending} onClick={deletePending ? undefined : onDelete}>
          <Icon name="delete" size={18} />
        </button>}
      </div>}
    </header>
    <div className="notification-card-details" id={detailsId} hidden={!expanded}>
      {expanded && <>
        <div className="notification-card-body">
          <strong aria-hidden="true">{title}</strong>
          <span className="notification-card-detail-meta">{categoryLabel}{dateLabel && ` · ${dateLabel}`}</span>
          {children}
        </div>
        {actions && <footer className="notification-card-actions">{actions}</footer>}
      </>}
    </div>
  </article>;
}
