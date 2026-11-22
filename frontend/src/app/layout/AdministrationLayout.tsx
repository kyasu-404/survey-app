import { NavLink, Outlet } from "react-router-dom";
import { routes } from "../routes";
import "./administration.css";

export function AdministrationLayout() {
  return (
    <div className="administration-layout">
      <nav className="administration-nav" aria-label="Администрирование">
        <NavLink className="app-button" to={routes.administration} end>Параметры приложения</NavLink>
        <NavLink className="app-button" to={routes.announcements}>Объявления</NavLink>
      </nav>
      <Outlet />
    </div>
  );
}
