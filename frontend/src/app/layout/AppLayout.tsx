import { useEffect, useState } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../providers/AuthProvider";
import { logout } from "../../features/auth/api";
import { routes } from "../routes";
import { Sidebar } from "../../widgets/Sidebar/Sidebar";

export function AppLayout() {
  const { user } = useAuth();
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    const toast = (location.state as { toast?: string } | null)?.toast;
    if (!toast) return;

    setToastMessage(toast);

    const timer = window.setTimeout(() => setToastMessage(null), 3000);
    navigate(location.pathname, { replace: true, state: null });

    return () => window.clearTimeout(timer);
  }, [location.pathname, location.state, navigate]);

  async function onLogout() {
    try {
      await logout();
      navigate(routes.login, { replace: true });
    } catch (error) {
      console.error(error);
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
        {toastMessage && (
          <div
            style={{
              marginBottom: 16,
              padding: 10,
              borderRadius: 8,
              background: "#dcfce7",
              color: "#166534",
              border: "1px solid #86efac"
            }}
          >
            {toastMessage}
          </div>
        )}
        <Outlet />
      </main>
    </div>
  );
}
