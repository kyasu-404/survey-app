import { Link } from "react-router-dom";
import { routes } from "../../app/routes";

export function Sidebar() {
  return (
    <aside style={{ minWidth: 220, borderRight: "1px solid #eee", padding: 16 }}>
      <h3>Survey App</h3>
      <nav style={{ display: "grid", gap: 8 }}>
        <Link to={routes.home}>Дашборд</Link>
        <Link to={routes.builder}>Конструктор</Link>
        <Link to={routes.login}>Войти</Link>
      </nav>
    </aside>
  );
}
