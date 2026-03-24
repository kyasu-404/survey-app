import { Link } from "react-router-dom";
import { routes } from "../../app/routes";
import { useAuth } from "../../app/providers/AuthProvider";
import { logout } from "../../features/auth/api";

export function Sidebar() {
  const { user, loading } = useAuth();

  async function onLogout() {
    try {
      await logout();
    } catch (error) {
      console.error(error);
    }
  }

  return (
    <aside style={{ minWidth: 220, borderRight: "1px solid #eee", padding: 16 }}>
      <h3>Survey App</h3>
      <nav style={{ display: "grid", gap: 8 }}>
        {loading && <span>Загрузка...</span>}

        {!loading && user && (
          <>
            <Link to={routes.home}>Дашборд</Link>
            <Link to={routes.builder}>Конструктор</Link>
            <button onClick={onLogout}>Выйти</button>
          </>
        )}

        {!loading && !user && <Link to={routes.login}>Войти</Link>}
      </nav>
    </aside>
  );
}
