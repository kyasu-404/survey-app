import { useState } from "react";
import { Link, NavLink, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { routes } from "../../app/routes";
import { useAuth } from "../../app/providers/AuthProvider";
import { APP_BRANDING_QUERY_KEY, getAppBranding } from "../../entities/branding/api";
import { getDefaultAppLogo } from "../../entities/branding/defaultLogo";
import { logout } from "../../features/auth/api";
import { SidebarAccountMenu } from "./SidebarAccountMenu";
import { useTheme } from "../../shared/theme/ThemeProvider";
import { Skeleton } from "../../shared/ui/Skeleton";
import { Icon } from "../../shared/ui/Icon";

type SidebarProps = {
  collapsed?: boolean;
  isMobile?: boolean;
  onToggle: () => void;
  onNavigate?: () => void;
};

export function Sidebar({ onToggle, onNavigate, collapsed = false, isMobile = false }: SidebarProps) {
  const { user, profile, loading } = useAuth();
  const { themeId } = useTheme();
  const [failedLogoUrl, setFailedLogoUrl] = useState<string | null>(null);
  const navigate = useNavigate();
  const brandingQuery = useQuery({
    queryKey: APP_BRANDING_QUERY_KEY,
    queryFn: getAppBranding,
    enabled: Boolean(user),
    staleTime: 60_000,
    refetchOnWindowFocus: true,
  });
  const defaultLogo = getDefaultAppLogo(themeId);
  const configuredLogo = brandingQuery.data?.sidebarLogoUrl;
  const sidebarLogo = configuredLogo && configuredLogo !== failedLogoUrl ? configuredLogo : defaultLogo;

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
          onError={() => {
            if (sidebarLogo !== defaultLogo) setFailedLogoUrl(sidebarLogo);
          }}
        />
        <h3 className="brand-title">Формы</h3>
        <button type="button" className="sidebar-toggle-button" onClick={onToggle} aria-label={isMobile ? "Скрыть меню" : collapsed ? "Развернуть меню" : "Свернуть меню"} aria-expanded={!collapsed} title={collapsed ? "Развернуть меню" : "Свернуть меню"}>
          <Icon name={collapsed ? "chevron_right" : "chevron_left"} />
        </button>
      </div>

      <nav className="sidebar-nav" aria-label="Основная навигация" onClick={(event) => {
        if ((event.target as HTMLElement).closest("a")) onNavigate?.();
      }}>
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
            <NavLink className={({ isActive }) => `nav-link ${isActive ? "nav-link-active" : ""}`.trim()} to={routes.dashboardAll} title="Все формы">
              <Icon name="description" className="sidebar-nav-icon" />
              <span className="sidebar-nav-label">Все формы</span>
            </NavLink>
            <NavLink className={({ isActive }) => `nav-link ${isActive ? "nav-link-active" : ""}`.trim()} to={routes.dashboardMy} title="Мои формы">
              <Icon name="folder" className="sidebar-nav-icon" />
              <span className="sidebar-nav-label">Мои формы</span>
            </NavLink>
            <span className="sidebar-nav-section">Рабочая область</span>
            <NavLink className={({ isActive }) => `nav-link ${isActive ? "nav-link-active" : ""}`.trim()} to={routes.templates} title="Шаблоны">
              <Icon name="dashboard_customize" className="sidebar-nav-icon" />
              <span className="sidebar-nav-label">Шаблоны</span>
            </NavLink>
            <NavLink className={({ isActive }) => `nav-link ${isActive ? "nav-link-active" : ""}`.trim()} to={routes.organizations} title="Справочник ОУ">
              <Icon name="school" className="sidebar-nav-icon" />
              <span className="sidebar-nav-label">Справочник ОУ</span>
            </NavLink>
            <NavLink className={({ isActive }) => `nav-link ${isActive ? "nav-link-active" : ""}`.trim()} to={routes.builder} title="Конструктор">
              <Icon name="edit_document" className="sidebar-nav-icon" />
              <span className="sidebar-nav-label">Конструктор</span>
            </NavLink>
            {profile?.role === "admin" && (
              <>
                <span className="sidebar-nav-section">Управление</span>
                <NavLink className={({ isActive }) => `nav-link ${isActive ? "nav-link-active" : ""}`.trim()} to={routes.users} title="Пользователи">
                  <Icon name="group" className="sidebar-nav-icon" />
                  <span className="sidebar-nav-label">Пользователи</span>
                </NavLink>
                <NavLink className={({ isActive }) => `nav-link ${isActive ? "nav-link-active" : ""}`.trim()} to={routes.settings} title="Настройки">
                  <Icon name="settings" className="sidebar-nav-icon" />
                  <span className="sidebar-nav-label">Настройки</span>
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
          <SidebarAccountMenu name={profile?.name?.trim() || user.email || 'Пользователь'} onLogout={onLogout}/>
        </div>
      )}
    </aside>
  );
}
