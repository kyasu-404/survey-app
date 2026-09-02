import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import LoginPage, { getSafeLoginTarget, getWelcomeMessage } from "./LoginPage";

vi.mock("../../app/providers/AuthProvider", () => ({
  useAuth: () => ({
    user: null,
    loading: false,
  }),
}));

vi.mock("../../features/auth/api", () => ({
  login: vi.fn(),
}));

describe("LoginPage", () => {
  it("accepts only same-origin application paths after login", () => {
    expect(getSafeLoginTarget("/dashboard/my")).toBe("/dashboard/my");
    expect(getSafeLoginTarget("//evil.example/path")).toBe("/dashboard/my");
    expect(getSafeLoginTarget("/\\evil.example/path")).toBe("/dashboard/my");
    expect(getSafeLoginTarget("https://evil.example/path")).toBe("/dashboard/my");
  });

  it("builds the welcome message from the profile name instead of email", () => {
    expect(getWelcomeMessage(" Анна Иванова ")).toBe("Добро пожаловать, Анна Иванова");
    expect(getWelcomeMessage("")).toBe("Добро пожаловать!");
  });

  it("renders premium auth styling hooks", () => {
    const { container } = render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>,
    );

    expect(container.querySelector(".login-card")).toBeInTheDocument();
    expect(container.querySelector(".login-form")).toBeInTheDocument();
    expect(container.querySelector(".login-fields")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Войти" })).toHaveClass("button-primary");
  });

  it("keeps the sign-in surface neutral regardless of the saved application theme", () => {
    const css = readFileSync(join(process.cwd(), "src/app.css"), "utf8");

    expect(css).toMatch(/\.app-shell-login,[^{]+\.app-shell-login\.app-shell-monochrome,[^{]+\.app-shell-login \.app-main-login\s*\{[^}]*color:\s*#18181b;[^}]*background:\s*linear-gradient\(145deg,\s*#f4f4f5 0%,\s*#e4e4e7 100%\)\s*!important;[^}]*color-scheme:\s*light;/s);
    expect(css).toMatch(/\.app-shell-login \.login-card\s*\{[^}]*color:\s*#18181b;[^}]*border-color:\s*#d4d4d8;[^}]*background:\s*#ffffff;/s);
  });
});
