import { Link, NavLink, useNavigate } from "react-router-dom";
import { routes } from "../../app/routes";
import { useAuth } from "../../app/providers/AuthProvider";
import { logout } from "../../features/auth/api";
import blackLogo from "../../img/black_logo.png";
import { Skeleton } from "../../shared/ui/Skeleton";

type SidebarProps = {
  onToggle: () => void;
};

export function Sidebar({ onToggle }: SidebarProps) {
  const { user, profile, loading } = useAuth();
  const navigate = useNavigate();

  async function onLogout() {
    try {
      await logout();
      navigate(routes.login, { replace: true });
    } catch (error) {
      console.error(error);
    }
  }

  return (
    <aside className="sidebar">
      <div className="brand">
        <img src={blackLogo} alt="Логотип ИМЦ" className="logo-image" />
        <h3 className="brand-title">Формы</h3>
        <button type="button" className="sidebar-toggle-button" onClick={onToggle} aria-label="Скрыть меню">
          ←
        </button>
      </div>

      <nav className="sidebar-nav">
        {loading && (
          <div className="sidebar-skeleton" aria-hidden="true">
            <Skeleton className="sidebar-skeleton-item" />
            <Skeleton className="sidebar-skeleton-item" />
            <Skeleton className="sidebar-skeleton-item" />
            <Skeleton className="sidebar-skeleton-item sidebar-skeleton-item-short" />
          </div>
        )}

        {!loading && user && (
          <>
            <NavLink className={({ isActive }) => `nav-link ${isActive ? "nav-link-active" : ""}`.trim()} to={routes.dashboardAll}>
              Все формы
            </NavLink>
            <NavLink className={({ isActive }) => `nav-link ${isActive ? "nav-link-active" : ""}`.trim()} to={routes.dashboardMy}>
              Мои формы
            </NavLink>
            <NavLink className={({ isActive }) => `nav-link ${isActive ? "nav-link-active" : ""}`.trim()} to={routes.templates}>
              Шаблоны
            </NavLink>
            <NavLink className={({ isActive }) => `nav-link ${isActive ? "nav-link-active" : ""}`.trim()} to={routes.builder}>
              Конструктор
            </NavLink>
            {profile?.role === "admin" && (
              <NavLink className={({ isActive }) => `nav-link ${isActive ? "nav-link-active" : ""}`.trim()} to={routes.users}>
                Пользователи
              </NavLink>
            )}
            <div className="sidebar-spacer" />
            <button className="logout-button" onClick={onLogout}>Выйти</button>
          </>
        )}

        {!loading && !user && (
          <Link className="nav-link" to={routes.login}>
            Войти
          </Link>
        )}
      </nav>
    </aside>
  );
}
