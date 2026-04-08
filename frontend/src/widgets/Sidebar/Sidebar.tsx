import { Link, NavLink, useNavigate } from "react-router-dom";
import { routes } from "../../app/routes";
import { useAuth } from "../../app/providers/AuthProvider";
import { logout } from "../../features/auth/api";
import blackLogo from "../../img/black_logo.png";

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
        <div className="brand-mark">
          <img src={blackLogo} alt="Логотип ИМЦ" className="logo-image" />
        </div>
        <div className="brand-copy">
          <p className="brand-eyebrow">Рабочее пространство</p>
          <h3 className="brand-title">Формы</h3>
        </div>
        <button type="button" className="sidebar-toggle-button" onClick={onToggle} aria-label="Скрыть меню">
          ←
        </button>
      </div>

      <nav className="sidebar-nav">
        <span className="sidebar-section-label">Навигация</span>
        {loading && <span>Загрузка...</span>}

        {!loading && user && (
          <>
            <NavLink className={({ isActive }) => `nav-link ${isActive ? "nav-link-active" : ""}`.trim()} to={routes.dashboardAll}>
              Все формы
            </NavLink>
            <NavLink className={({ isActive }) => `nav-link ${isActive ? "nav-link-active" : ""}`.trim()} to={routes.dashboardMy}>
              Мои формы
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
            <div className="sidebar-account">
              <p className="sidebar-account-name">{profile?.name || user.email || "Аккаунт"}</p>
              <p className="sidebar-account-role">{profile?.role === "admin" ? "Администратор" : "Пользователь"}</p>
              <button className="logout-button" onClick={onLogout}>Выйти</button>
            </div>
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
