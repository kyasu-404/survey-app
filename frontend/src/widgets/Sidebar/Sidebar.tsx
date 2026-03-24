import { Link } from "react-router-dom";

export function Sidebar() {
  return (
    <aside style={{ minWidth: 220, borderRight: "1px solid #eee", padding: 16 }}>
      <h3>Survey App</h3>
      <nav style={{ display: "grid", gap: 8 }}>
        <Link to="/">Дашборд</Link>
        <Link to="/builder">Конструктор</Link>
        <Link to="/login">Войти</Link>
      </nav>
    </aside>
  );
}
