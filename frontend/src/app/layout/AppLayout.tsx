import { useEffect, useState } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { routes } from "../routes";
import { Sidebar } from "../../widgets/Sidebar/Sidebar";
import { useToast } from "../providers/ToastProvider";

export function AppLayout() {
  const { showToast } = useToast();
  const location = useLocation();
  const navigate = useNavigate();
  const isLoginPage = location.pathname === routes.login;
  const isSurveyPage = location.pathname.startsWith("/form/");
  const shouldHideSidebar = isLoginPage || isSurveyPage;
  const [isSidebarHidden, setIsSidebarHidden] = useState(false);

  useEffect(() => {
    const toast = (location.state as { toast?: string } | null)?.toast;
    if (!toast) return;

    showToast(toast, "success");
    navigate(location.pathname, { replace: true, state: null });
  }, [location.pathname, location.state, navigate, showToast]);

  return (
    <div className={shouldHideSidebar ? "app-shell app-shell-login" : `app-shell ${isSidebarHidden ? "app-shell-sidebar-hidden" : ""}`.trim()}>
      {!shouldHideSidebar && isSidebarHidden && (
        <button
          type="button"
          className="sidebar-open-button"
          onClick={() => setIsSidebarHidden(false)}
          aria-label="Показать меню"
        >
          →
        </button>
      )}
      {!shouldHideSidebar && !isSidebarHidden && <Sidebar onToggle={() => setIsSidebarHidden(true)} />}
      <main className={shouldHideSidebar ? "app-main app-main-login" : "app-main"}>
        <Outlet />
      </main>
    </div>
  );
}
