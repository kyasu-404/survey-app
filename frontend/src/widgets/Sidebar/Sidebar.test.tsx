import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { routes } from "../../app/routes";
import { Sidebar } from "./Sidebar";

const { authState, getAppBranding } = vi.hoisted(() => ({
  authState: { role: "user" as "user" | "admin" },
  getAppBranding: vi.fn(),
}));

vi.mock("../../app/providers/AuthProvider", () => ({
  useAuth: () => ({
    user: { id: "user-1" },
    profile: { role: authState.role },
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
        <Sidebar onToggle={vi.fn()} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function readAppCss() {
  return readFileSync(join(process.cwd(), "src/app.css"), "utf8");
}

describe("Sidebar", () => {
  beforeEach(() => {
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
          <Sidebar onToggle={vi.fn()} />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(screen.queryByRole("link", { name: "Настройки" })).not.toBeInTheDocument();

    authState.role = "admin";
    rerender(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <Sidebar onToggle={vi.fn()} />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(screen.getByRole("link", { name: "Настройки" })).toHaveAttribute("href", routes.settings);
  });

  it("keeps the logout action in a separate sidebar footer", () => {
    const { container } = renderSidebar();

    const footerLogoutButton = container.querySelector(".sidebar-footer .logout-button");

    expect(footerLogoutButton).toBe(screen.getByRole("button", { name: "Выйти" }));
    expect(container.querySelector(".sidebar-footer .sidebar-theme-button")).toBe(
      screen.getByRole("button", { name: /Сменить тему/i }),
    );
    expect(container.querySelector(".sidebar-nav .logout-button")).not.toBeInTheDocument();
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

  it("lets the theme menu render above and outside the sidebar", () => {
    const css = readAppCss();

    expect(css).toMatch(/\.sidebar\s*\{[^}]*overflow:\s*visible;[^}]*z-index:\s*500;/s);
    expect(css).toMatch(/\.theme-cycle-menu\s*\{[^}]*z-index:\s*520;/s);
  });

  it("colors the sidebar utility controls with the active application theme", () => {
    const css = readAppCss();
    const surfaceOverrides = css.slice(css.indexOf("Keep every application scheme inside one color temperature"));

    expect(surfaceOverrides).not.toMatch(/\.sidebar\s*\{[^}]*background:\s*#fbfbfc;/s);
    expect(surfaceOverrides).not.toMatch(/\.sidebar \.nav-link,[^{]+\{[^}]*background:\s*#ffffff;/s);
    expect(surfaceOverrides).toMatch(/\.sidebar-toggle-button,[^{]+\.sidebar \.logout-button:focus-visible\s*\{[^}]*border:\s*1px solid var\(--theme-border\);[^}]*background:\s*var\(--theme-surface-light\);/s);
  });
});
