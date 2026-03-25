import { Link, useNavigate } from "react-router-dom";
import { routes } from "../../app/routes";
import { useAuth } from "../../app/providers/AuthProvider";
import { logout } from "../../features/auth/api";

export function Sidebar() {
  const { user, loading } = useAuth();
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
        <div className="logo" aria-label="Логотип приложения">
          SA
        </div>
        <h3 className="brand-title">Опросы</h3>
      </div>

      <nav className="sidebar-nav">
        {loading && <span>Загрузка...</span>}

        {!loading && user && (
          <>
            <Link className="nav-link" to={routes.home}>
              Дашборд
            </Link>
            <Link className="nav-link" to={routes.builder}>
              Конструктор
            </Link>
            <button onClick={onLogout}>Выйти</button>
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
