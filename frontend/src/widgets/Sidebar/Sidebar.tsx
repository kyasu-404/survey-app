import { Link, useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { routes } from "../../app/routes";
import { useAuth } from "../../app/providers/AuthProvider";
import { logout } from "../../features/auth/api";

export function Sidebar() {
  const { user, profile, loading } = useAuth();
  const navigate = useNavigate();
  const [isDarkTheme, setIsDarkTheme] = useState(false);

  useEffect(() => {
    const savedTheme = window.localStorage.getItem("theme");
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const shouldUseDark = savedTheme ? savedTheme === "dark" : prefersDark;

    setIsDarkTheme(shouldUseDark);
    document.documentElement.setAttribute("data-theme", shouldUseDark ? "dark" : "light");
  }, []);

  function toggleTheme() {
    setIsDarkTheme((prev) => {
      const next = !prev;
      document.documentElement.setAttribute("data-theme", next ? "dark" : "light");
      window.localStorage.setItem("theme", next ? "dark" : "light");
      return next;
    });
  }

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
        <div className="logo" aria-label="Логотип приложения">
          SA
        </div>
        <h3 className="brand-title">Формы</h3>
      </div>

      <nav className="sidebar-nav">
        {loading && <span>Загрузка...</span>}

        {!loading && user && (
          <>
            <Link className="nav-link" to={routes.dashboardMy}>
              Дашборд
            </Link>
            <Link className="nav-link" to={routes.builder}>
              Конструктор
            </Link>
            {profile?.role === "admin" && (
              <Link className="nav-link" to={routes.users}>
                Пользователи
              </Link>
            )}
            <button onClick={onLogout}>Выйти</button>
          </>
        )}

        {!loading && !user && (
          <Link className="nav-link" to={routes.login}>
            Войти
          </Link>
        )}
      </nav>
      <div className="sidebar-footer">
        <button className="theme-toggle-button" onClick={toggleTheme}>
          {isDarkTheme ? "Светлая тема" : "Тёмная тема"}
        </button>
      </div>
    </aside>
  );
}
