import { NavLink } from "react-router-dom";
import { routes } from "../../app/routes";
import { useAuth } from "../../app/providers/AuthProvider";
import { useUnreadCount } from "../../entities/notification/useNotifications";
import { Icon } from "../../shared/ui/Icon";

export function NotificationsLink({ userId, mobile = false }: { userId: string; mobile?: boolean }) {
  const { data: unread = 0 } = useUnreadCount(userId);
  const label = unread ? "Уведомления, непрочитанных: " + unread : "Уведомления";
  return (
    <NavLink to={routes.notifications} aria-label={label} title={label}
      className={({ isActive }) => (mobile ? "app-button mobile-notifications-button" : "nav-link") +
        " notifications-link" + (isActive ? " nav-link-active" : "")}>
      <Icon name="notifications" className={mobile ? undefined : "sidebar-nav-icon"} />
      {!mobile && <span className="sidebar-nav-label">Уведомления</span>}
      {unread > 0 && <span className="notification-counter" aria-hidden="true">{unread > 99 ? "99+" : unread}</span>}
    </NavLink>
  );
}

export function MobileNotificationsLink() {
  const { user, loading } = useAuth();
  return user && !loading ? <NotificationsLink userId={user.id} mobile /> : null;
}
