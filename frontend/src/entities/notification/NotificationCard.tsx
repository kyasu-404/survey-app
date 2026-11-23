import { useId, type ReactNode } from "react";
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

type NotificationCardProps = {
  category: NotificationCategory;
  title: string;
  createdAt?: string;
  unread: boolean;
  preview?: boolean;
  markPending?: boolean;
  onMarkRead?: () => void;
  children: ReactNode;
  actions?: ReactNode;
};

export function NotificationCard({
  category, title, createdAt, unread, preview, markPending, onMarkRead, children, actions,
}: NotificationCardProps) {
  const titleId = useId();
  const Heading = preview ? "h4" : "h2";
  const knownCategory = Object.prototype.hasOwnProperty.call(categoryIcons, category);

  return <article className="notification-card" aria-labelledby={titleId} data-unread={unread}>
    <header className="notification-card-header">
      <div className="notification-card-category">
        <Icon name={knownCategory ? categoryIcons[category] : "notifications"} size={18} />
        <span>{knownCategory ? notificationCategories[category] : "Уведомление"}</span>
        {unread && <span className="notification-card-unread" role="img" aria-label="Непрочитанное" />}
      </div>
      {(createdAt || unread) && <div className="notification-card-meta">
        {createdAt && <time dateTime={createdAt}>{formatActivityTime(createdAt)}</time>}
        {unread && <button type="button" className="app-button icon-button notification-card-read"
          aria-label="Отметить прочитанным" title="Отметить прочитанным"
          disabled={preview || markPending} onClick={onMarkRead}>
          <Icon name="check_circle" size={18} />
        </button>}
      </div>}
    </header>
    <div className="notification-card-body">
      <Heading id={titleId} className="notification-card-title">{title}</Heading>
      {children}
    </div>
    {actions && <footer className="notification-card-actions">{actions}</footer>}
  </article>;
}
