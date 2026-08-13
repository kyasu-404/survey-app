import { Link, NavLink, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { routes } from "../../app/routes";
import { useAuth } from "../../app/providers/AuthProvider";
import { APP_BRANDING_QUERY_KEY, getAppBranding } from "../../entities/branding/api";
import { logout } from "../../features/auth/api";
import blackLogo from "../../img/black_logo.png";
import { ThemeCycleButton } from "../../shared/theme/ThemeCycleButton";
import { Skeleton } from "../../shared/ui/Skeleton";

type SidebarProps = {
  onToggle: () => void;
};

export function Sidebar({ onToggle }: SidebarProps) {
  const { user, profile, loading } = useAuth();
  const navigate = useNavigate();
  const brandingQuery = useQuery({
    queryKey: APP_BRANDING_QUERY_KEY,
    queryFn: getAppBranding,
    enabled: Boolean(user),
    staleTime: 60_000,
    refetchOnWindowFocus: true,
  });
  const sidebarLogo = brandingQuery.data?.sidebarLogoUrl ?? blackLogo;

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
        <img
          src={sidebarLogo}
          alt="Логотип приложения"
          className="logo-image"
          onError={(event) => {
            if (event.currentTarget.dataset.fallbackApplied) return;
            event.currentTarget.dataset.fallbackApplied = "true";
            event.currentTarget.src = blackLogo;
          }}
        />
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
            <NavLink className={({ isActive }) => `nav-link ${isActive ? "nav-link-active" : ""}`.trim()} to={routes.organizations}>
              Справочник ОУ
            </NavLink>
            <NavLink className={({ isActive }) => `nav-link ${isActive ? "nav-link-active" : ""}`.trim()} to={routes.builder}>
              Конструктор
            </NavLink>
            {profile?.role === "admin" && (
              <>
                <NavLink className={({ isActive }) => `nav-link ${isActive ? "nav-link-active" : ""}`.trim()} to={routes.users}>
                  Пользователи
                </NavLink>
                <NavLink className={({ isActive }) => `nav-link ${isActive ? "nav-link-active" : ""}`.trim()} to={routes.settings}>
                  Настройки
                </NavLink>
              </>
            )}
          </>
        )}

        {!loading && !user && (
          <Link className="nav-link" to={routes.login}>
            Войти
          </Link>
        )}
      </nav>

      {!loading && user && (
        <div className="sidebar-footer">
          <button className="logout-button" onClick={onLogout}>Выйти</button>
          <ThemeCycleButton className="sidebar-theme-button" menuPlacement="top-right" />
        </div>
      )}
    </aside>
  );
}
