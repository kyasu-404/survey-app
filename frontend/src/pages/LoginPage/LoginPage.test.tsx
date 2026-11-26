import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { login } from "../../features/auth/api";
import { readAppCss } from "../../test/readAppCss";
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

  it("opens the linked response after signing in", async () => {
    vi.mocked(login).mockResolvedValueOnce("Анна Иванова");
    const from = {
      pathname: "/dashboard/forms/form-id/responses",
      search: "?response=answer-id",
      hash: "#details",
    };
    function Destination() {
      const { search, hash } = useLocation();
      return <p>{search + hash}</p>;
    }
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={[{ pathname: "/login", state: { from } }]}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path={from.pathname} element={<Destination />} />
        </Routes>
      </MemoryRouter>,
    );
    await user.type(screen.getByLabelText("Электронная почта"), "owner@example.invalid");
    await user.type(screen.getByLabelText("Пароль", { exact: true }), "password");
    await user.click(screen.getByRole("button", { name: "Войти" }));
    expect(await screen.findByText("?response=answer-id#details")).toBeInTheDocument();
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
    const css = readAppCss();

    expect(css).toMatch(/\.app-shell-login,[^{]+\.app-shell-login\.app-shell-monochrome,[^{]+\.app-shell-login \.app-main-login\s*\{[^}]*color:\s*#18181b;[^}]*background:\s*var\(--survey-page-backdrop\)\s*!important;[^}]*color-scheme:\s*light;/s);
    expect(css).toMatch(/\.app-shell-login \.login-card\s*\{[^}]*color:\s*#18181b;[^}]*border-color:\s*#d4d4d8;[^}]*background:\s*#ffffff;/s);
  });
});
