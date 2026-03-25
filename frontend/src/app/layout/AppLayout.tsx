import { useEffect } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../providers/AuthProvider";
import { logout } from "../../features/auth/api";
import { routes } from "../routes";
import { Sidebar } from "../../widgets/Sidebar/Sidebar";
import { useToast } from "../providers/ToastProvider";

export function AppLayout() {
  const { user } = useAuth();
  const { showToast } = useToast();
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    const toast = (location.state as { toast?: string } | null)?.toast;
    if (!toast) return;

    showToast(toast, "success");
    navigate(location.pathname, { replace: true, state: null });
  }, [location.pathname, location.state, navigate, showToast]);

  async function onLogout() {
    try {
      await logout();
      navigate(routes.login, { replace: true });
    } catch (error) {
      console.error(error);
      showToast("Не удалось выйти из системы", "error");
    }
  }

  return (
    <div className="app-shell">
      <Sidebar />
      <main className="app-main">
        <div className="topbar">
          {user?.email && (
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <span>Вы вошли как {user.email}</span>
              <button onClick={onLogout}>Выйти</button>
            </div>
          )}
        </div>
        <Outlet />
      </main>
    </div>
  );
}
