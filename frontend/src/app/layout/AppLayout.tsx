import { useEffect, useRef, useState } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { routes } from "../routes";
import { Sidebar } from "../../widgets/Sidebar/Sidebar";
import { useToast } from "../providers/ToastProvider";
import { useSidebarMotion } from "./useSidebarMotion";

export function AppLayout() {
  const { showToast } = useToast();
  const location = useLocation();
  const navigate = useNavigate();
  const isLoginPage = location.pathname === routes.login;
  const isSurveyPage = location.pathname.startsWith("/form/");
  const isOfficePage = /^\/forms\/[^/]+\/documents\//.test(location.pathname);
  const shouldHideSidebar = isLoginPage || isSurveyPage || isOfficePage;
  const [isSidebarHidden, setIsSidebarHidden] = useState(false);
  const sidebarMotion = useSidebarMotion(location.pathname);

  const sidebarRegion = useRef<HTMLDivElement>(null);
  const showMenuButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const region = sidebarRegion.current;
    if (!region) return;
    const hadFocus = region.contains(document.activeElement);
    region.inert = isSidebarHidden;
    if (isSidebarHidden && hadFocus) showMenuButton.current?.focus();
  }, [isSidebarHidden, shouldHideSidebar]);

  useEffect(() => {
    const toast = (location.state as { toast?: string } | null)?.toast;
    if (!toast) return;

    showToast(toast, "success");
    navigate(location.pathname, { replace: true, state: null });
  }, [location.pathname, location.state, navigate, showToast]);

  return (
    <div
      className={
        shouldHideSidebar
          ? "app-shell app-shell-login app-shell-monochrome"
          : `app-shell app-shell-monochrome ${isSidebarHidden ? "app-shell-sidebar-hidden" : ""}`.trim()
      }
    >
      {!shouldHideSidebar && isSidebarHidden && (
        <button
          type="button"
          className="sidebar-open-button"
          ref={showMenuButton}
          onClick={() => sidebarMotion.change(() => setIsSidebarHidden(false))}
          aria-label="Показать меню"
        >
          →
        </button>
      )}
      {!shouldHideSidebar && (
        <div className="sidebar-region" ref={sidebarRegion} aria-hidden={isSidebarHidden || undefined}>
          <div className="sidebar-clip"><Sidebar onToggle={() => sidebarMotion.change(() => setIsSidebarHidden(true))} /></div>
        </div>
      )}
      <main onClickCapture={sidebarMotion.finish} onKeyDownCapture={sidebarMotion.finish} className={isOfficePage ? "app-main app-main-office" : shouldHideSidebar ? "app-main app-main-login app-main-public" : "app-main"}>
        <Outlet />
      </main>
    </div>
  );
}
