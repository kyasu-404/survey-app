import { render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { routes } from "../../app/routes";
import { Sidebar } from "./Sidebar";

vi.mock("../../app/providers/AuthProvider", () => ({
  useAuth: () => ({
    user: { id: "user-1" },
    profile: { role: "user" },
    loading: false,
  }),
}));

vi.mock("../../features/auth/api", () => ({
  logout: vi.fn(),
}));

function readAppCss() {
  return readFileSync(join(process.cwd(), "src/app.css"), "utf8");
}

describe("Sidebar", () => {
  it("links to the templates gallery as a separate tab", () => {
    render(
      <MemoryRouter>
        <Sidebar onToggle={vi.fn()} />
      </MemoryRouter>,
    );

    expect(screen.getByRole("link", { name: "Шаблоны" })).toHaveAttribute("href", routes.templates);
    expect(screen.getByRole("link", { name: "Справочник ОУ" })).toHaveAttribute("href", routes.organizations);
  });

  it("keeps the logout action in a separate sidebar footer", () => {
    const { container } = render(
      <MemoryRouter>
        <Sidebar onToggle={vi.fn()} />
      </MemoryRouter>,
    );

    const footerLogoutButton = container.querySelector(".sidebar-footer .logout-button");

    expect(footerLogoutButton).toBe(screen.getByRole("button", { name: "Выйти" }));
    expect(container.querySelector(".sidebar-footer .sidebar-theme-button")).toBe(
      screen.getByRole("button", { name: /Сменить тему/i }),
    );
    expect(container.querySelector(".sidebar-nav .logout-button")).not.toBeInTheDocument();
  });

  it("centers the sidebar toggle arrow inside the button", () => {
    const css = readAppCss();

    expect(css).toMatch(
      /\.sidebar-toggle-button,\s*\.sidebar-open-button\s*\{[^}]*display:\s*inline-flex;[^}]*align-items:\s*center;[^}]*justify-content:\s*center;[^}]*line-height:\s*1;/,
    );
  });

  it("lets the theme menu render above and outside the sidebar", () => {
    const css = readAppCss();

    expect(css).toMatch(/\.sidebar\s*\{[^}]*overflow:\s*visible;[^}]*z-index:\s*500;/s);
    expect(css).toMatch(/\.theme-cycle-menu\s*\{[^}]*z-index:\s*520;/s);
  });

  it("keeps only the sidebar utility controls neutral in every application theme", () => {
    const css = readAppCss();
    const surfaceOverrides = css.slice(css.indexOf("Keep every application scheme inside one color temperature"));

    expect(surfaceOverrides).not.toMatch(/\.sidebar\s*\{[^}]*background:\s*#fbfbfc;/s);
    expect(surfaceOverrides).not.toMatch(/\.sidebar \.nav-link,[^{]+\{[^}]*background:\s*#ffffff;/s);
    expect(surfaceOverrides).toMatch(/\.sidebar-toggle-button,[^{]+\.sidebar \.logout-button:focus-visible\s*\{[^}]*border:\s*1px solid rgba\(17,\s*17,\s*17,\s*0\.38\);[^}]*background:\s*#ffffff;/s);
  });
});
