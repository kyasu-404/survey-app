import { useEffect } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { routes } from "../routes";
import { Sidebar } from "../../widgets/Sidebar/Sidebar";
import { useToast } from "../providers/ToastProvider";

export function AppLayout() {
  const { showToast } = useToast();
  const location = useLocation();
  const navigate = useNavigate();
  const isLoginPage = location.pathname === routes.login;

  useEffect(() => {
    const toast = (location.state as { toast?: string } | null)?.toast;
    if (!toast) return;

    showToast(toast, "success");
    navigate(location.pathname, { replace: true, state: null });
  }, [location.pathname, location.state, navigate, showToast]);

  return (
    <div className={isLoginPage ? "app-shell app-shell-login" : "app-shell"}>
      {!isLoginPage && <Sidebar />}
      <main className={isLoginPage ? "app-main app-main-login" : "app-main"}>
        <Outlet />
      </main>
    </div>
  );
}
