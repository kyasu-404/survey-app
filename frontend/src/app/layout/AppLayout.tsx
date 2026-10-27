import { useEffect, useRef, useState } from "react";
import { matchPath, Outlet, useLocation, useNavigate } from "react-router-dom";
import { routes } from "../routes";
import { Sidebar } from "../../widgets/Sidebar/Sidebar";
import { useToast } from "../providers/ToastProvider";
import { useSidebarMotion } from "./useSidebarMotion";
import { useMobileLayout } from "../../shared/ui/useMobileLayout";
import { Icon } from "../../shared/ui/Icon";

const mobileHeaderTitles = [
  { path: routes.dashboardMy, title: "Мои формы" },
  { path: routes.dashboardAll, title: "Все формы" },
  { path: routes.templates, title: "Шаблоны" },
  { path: routes.organizations, title: "Справочник ОУ" },
  { path: routes.builder, title: "Конструктор" },
  { path: routes.formResponsesById, title: "Ответы на форму" },
  { path: routes.users, title: "Пользователи" },
  { path: routes.settings, title: "Настройки" },
];

export function AppLayout() {
  const { showToast } = useToast();
  const location = useLocation();
  const mobileHeaderTitle = mobileHeaderTitles.find(({ path }) =>
    matchPath({ path, end: false }, location.pathname),
  )?.title ?? "Формы";
  const navigate = useNavigate();
  const isLoginPage = location.pathname === routes.login;
  const isSurveyPage = location.pathname.startsWith("/form/");
  const isOfficePage = /^\/forms\/[^/]+\/documents\//.test(location.pathname);
  const shouldHideSidebar = isLoginPage || isSurveyPage || isOfficePage;
  const isMobile = useMobileLayout();
  const [desktopSidebarCollapsed, setDesktopSidebarCollapsed] = useState(false);
  const [expandedBuilderLocation, setExpandedBuilderLocation] = useState<string | null>(null);
  const isBuilder = Boolean(matchPath({ path: routes.builder, end: false }, location.pathname));
  const isSidebarCollapsed = !isMobile && (isBuilder ? expandedBuilderLocation !== location.key : desktopSidebarCollapsed);
  const [mobileMenuLocation, setMobileMenuLocation] = useState<string | null>(null);
  const isMobileMenuOpen = isMobile && mobileMenuLocation === location.key && !shouldHideSidebar;
  const sidebarHidden = isMobile && !isMobileMenuOpen;
  const sidebarMotion = useSidebarMotion(location.pathname);

  const sidebarRegion = useRef<HTMLDivElement>(null);
  const showMenuButton = useRef<HTMLButtonElement>(null);
  const mobileHeader = useRef<HTMLElement>(null);
  const mainRegion = useRef<HTMLElement>(null);
  useEffect(() => {
    const region = sidebarRegion.current;
    if (!region) return;
    const hadFocus = region.contains(document.activeElement);
    region.inert = sidebarHidden;
    if (sidebarHidden && hadFocus) showMenuButton.current?.focus();
  }, [sidebarHidden, shouldHideSidebar]);

  useEffect(() => {
    if (!isMobileMenuOpen) return;
    const main = mainRegion.current;
    const header = mobileHeader.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    if (main) main.inert = true;
    if (header) header.inert = true;
    sidebarRegion.current?.querySelector<HTMLButtonElement>(".sidebar-toggle-button")?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (event.key === "Escape") {
        event.preventDefault();
        setMobileMenuLocation(null);
      }
      if (event.key !== "Tab") return;
      const controls = Array.from(sidebarRegion.current?.querySelectorAll<HTMLElement>(
        'a[href], button:not(:disabled), select:not(:disabled), input:not(:disabled), [tabindex="0"]',
      ) ?? []).filter((element) => element.getClientRects().length > 0 && !element.closest('[aria-hidden="true"]'));
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      if (main) main.inert = false;
      if (header) header.inert = false;
      showMenuButton.current?.focus({ preventScroll: true });
    };
  }, [isMobileMenuOpen]);

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
          : `app-shell app-shell-monochrome ${sidebarHidden ? "app-shell-sidebar-hidden" : ""} ${isSidebarCollapsed ? "app-shell-sidebar-rail" : ""}`.trim()
      }
    >
      {!shouldHideSidebar && isMobile && (
        <header className="mobile-app-header" ref={mobileHeader}>
          <button
            type="button"
            className="app-button mobile-menu-button"
            ref={showMenuButton}
            onClick={() => setMobileMenuLocation(location.key)}
            aria-label="Показать меню"
            aria-expanded={isMobileMenuOpen}
            aria-controls="app-sidebar"
          >
            <Icon name="menu" size={24} />
          </button>
          <span>{mobileHeaderTitle}</span>
        </header>
      )}
      {isMobileMenuOpen && <div className="mobile-sidebar-backdrop" aria-hidden="true" onClick={() => setMobileMenuLocation(null)} />}
      {!shouldHideSidebar && (
        <div
          id="app-sidebar"
          className="sidebar-region"
          ref={sidebarRegion}
          aria-hidden={sidebarHidden || undefined}
          role={isMobileMenuOpen ? "dialog" : undefined}
          aria-modal={isMobileMenuOpen || undefined}
          aria-label={isMobileMenuOpen ? "Главное меню" : undefined}
        >
          <div className="sidebar-clip"><Sidebar
            collapsed={isSidebarCollapsed}
            isMobile={isMobile}
            onNavigate={() => setMobileMenuLocation(null)}
            onToggle={() => isMobile ? setMobileMenuLocation(null) : sidebarMotion.change(() => {
              if (isBuilder) setExpandedBuilderLocation(isSidebarCollapsed ? location.key : null);
              else setDesktopSidebarCollapsed(current => !current);
            })}
          /></div>
        </div>
      )}
      <main ref={mainRegion} onClickCapture={sidebarMotion.finish} onKeyDownCapture={sidebarMotion.finish} className={isOfficePage ? "app-main app-main-office" : shouldHideSidebar ? "app-main app-main-login app-main-public" : "app-main"}>
        <Outlet />
      </main>
    </div>
  );
}
