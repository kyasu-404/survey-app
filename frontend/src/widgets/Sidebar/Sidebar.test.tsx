import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { routes } from "../../app/routes";
import { logout } from "../../features/auth/api";
import { ThemeProvider } from "../../shared/theme/ThemeProvider";
import { readAppCss } from "../../test/readAppCss";
import { Sidebar } from "./Sidebar";

const { authState, getAppBranding } = vi.hoisted(() => ({
  authState: { role: "user" as "user" | "admin" },
  getAppBranding: vi.fn(),
}));

vi.mock("../../app/providers/AuthProvider", () => ({
  useAuth: () => ({
    user: { id: "user-1" },
    profile: { role: authState.role, name: "Анна Иванова" },
    loading: false,
  }),
}));

vi.mock("../../features/auth/api", () => ({
  logout: vi.fn(),
}));

vi.mock("../../entities/branding/api", () => ({
  APP_BRANDING_QUERY_KEY: ["app-branding"],
  getAppBranding,
}));

function renderSidebar() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <ThemeProvider><Sidebar onToggle={vi.fn()} /></ThemeProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}



describe("Sidebar", () => {
  beforeEach(() => {
    localStorage.clear();
    delete document.documentElement.dataset.theme;
    authState.role = "user";
    getAppBranding.mockResolvedValue({ sidebarLogoPath: null, sidebarLogoUrl: null, updatedAt: null });
  });

  it("links to the templates gallery as a separate tab", () => {
    renderSidebar();

    expect(screen.getByRole("link", { name: "Шаблоны" })).toHaveAttribute("href", routes.templates);
    expect(screen.getByRole("link", { name: "Справочник ОУ" })).toHaveAttribute("href", routes.organizations);
  });

  it("shows Settings only to administrators", () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { rerender } = render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <ThemeProvider><Sidebar onToggle={vi.fn()} /></ThemeProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(screen.queryByRole("link", { name: "Настройки" })).not.toBeInTheDocument();

    authState.role = "admin";
    rerender(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <ThemeProvider><Sidebar onToggle={vi.fn()} /></ThemeProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(screen.getByRole("link", { name: "Настройки" })).toHaveAttribute("href", routes.settings);
  });

  it("opens account actions by name, changes theme and logs out", async () => {
    renderSidebar();const user=userEvent.setup();const trigger=screen.getByRole('button',{name:'Анна Иванова'});
    expect(screen.queryByRole('menuitem',{name:'Выйти'})).not.toBeInTheDocument();
    await user.click(trigger);
    const accountHeader = screen.getByRole('menu').querySelector('.sidebar-account-header');
    expect(accountHeader).toHaveTextContent('Анна Иванова');
    expect(accountHeader?.querySelector('.sidebar-account-avatar')).toHaveAttribute('aria-hidden', 'true');
    expect(trigger).toHaveTextContent('А');
    expect(trigger).not.toHaveTextContent('Анна Иванова');
    expect(trigger).toHaveAttribute('title', 'Анна Иванова');
    expect(screen.getAllByRole('menuitemradio')).toHaveLength(2);
    expect(screen.getAllByRole('menuitem')).toHaveLength(1);
    await user.click(screen.getByRole('menuitemradio',{name:'Тёмная тема'}));
    expect(document.documentElement).toHaveAttribute('data-theme','graphite');
    expect(screen.getByRole('menu')).toBeInTheDocument();
    expect(screen.getByRole('menuitemradio',{name:'Тёмная тема'})).toHaveFocus();
    expect(screen.getByRole('menuitem',{name:'Выйти'}).querySelector('[data-icon="logout"]')).toHaveAttribute('aria-hidden', 'true');
    await user.keyboard('{Escape}');expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    await user.click(trigger);await user.click(screen.getByRole('menuitem',{name:'Выйти'}));await waitFor(()=>expect(logout).toHaveBeenCalled());
  });

  it("shows the configured application logo", async () => {
    getAppBranding.mockResolvedValue({
      sidebarLogoPath: "app-branding/sidebar-logo-11111111-1111-4111-8111-111111111111.png",
      sidebarLogoUrl: "https://storage.test/sidebar-logo.png?v=1",
      updatedAt: "2026-08-13T12:00:00.000Z",
    });
    renderSidebar();

    const logo = screen.getByRole("img", { name: "Логотип приложения" });
    await waitFor(() => expect(logo).toHaveAttribute(
      "src",
      "https://storage.test/sidebar-logo.png?v=1",
    ));
  });

  it("centers the sidebar toggle arrow inside the button", () => {
    const css = readAppCss();

    expect(css).toMatch(
      /\.sidebar-toggle-button,\s*\.sidebar-open-button\s*\{[^}]*display:\s*inline-flex;[^}]*align-items:\s*center;[^}]*justify-content:\s*center;[^}]*line-height:\s*1;/,
    );
  });

  it("shows the application logo as an unclipped square", () => {
    const css = readAppCss();
    const logoRules = css.match(/\.logo-image\s*\{[^}]*\}/g) ?? [];
    const finalLogoRule = logoRules[logoRules.length - 1];

    expect(logoRules.length).toBeGreaterThan(0);
    expect(logoRules.every((rule) => /border-radius:\s*0;/.test(rule))).toBe(true);
    expect(finalLogoRule).toMatch(/background:\s*transparent;/);
    expect(finalLogoRule).toMatch(/box-shadow:\s*none;/);
  });

  it("lets the account menu render above and outside the sidebar", () => {
    const css = readAppCss();

    expect(css).toMatch(/\.sidebar\s*\{[^}]*overflow:\s*visible;[^}]*z-index:\s*500;/s);
    expect(css).toMatch(/\.sidebar-account \.sidebar-account-menu\s*\{[^}]*z-index:\s*520;/s);
  });

  it("colors the sidebar utility controls with the active application theme", () => {
    const css = readAppCss();
    const surfaceOverrides = css.slice(css.indexOf("Keep every application scheme inside one color temperature"));

    expect(surfaceOverrides).not.toMatch(/\.sidebar\s*\{[^}]*background:\s*#fbfbfc;/s);
    expect(surfaceOverrides).not.toMatch(/\.sidebar \.nav-link,[^{]+\{[^}]*background:\s*#ffffff;/s);
    expect(surfaceOverrides).toMatch(/\.sidebar-toggle-button,[^{]+\.sidebar \.logout-button:focus-visible\s*\{[^}]*border:\s*1px solid var\(--theme-border\);[^}]*background:\s*var\(--theme-surface-light\);/s);
  });
});
