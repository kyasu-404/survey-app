import { Link, NavLink, useNavigate } from "react-router-dom";
import { routes } from "../../app/routes";
import { useAuth } from "../../app/providers/AuthProvider";
import { logout } from "../../features/auth/api";
import blackLogo from "../../img/black_logo.png";

export function Sidebar() {
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
      </div>

      <nav className="sidebar-nav">
        {loading && <span>Загрузка...</span>}

        {!loading && user && (
          <>
            <NavLink className={({ isActive }) => `nav-link ${isActive ? "nav-link-active" : ""}`.trim()} to={routes.dashboardMy}>
              Мои формы
            </NavLink>
            <NavLink className={({ isActive }) => `nav-link ${isActive ? "nav-link-active" : ""}`.trim()} to={routes.dashboardAll}>
              Все формы
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
