import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { login } from "../../features/auth/api";
import { readAppCss } from "../../test/readAppCss";
import LoginPage, { getSafeLoginTarget, getWelcomeMessage } from "./LoginPage";

const authState = vi.hoisted(() => ({
  user: null as { id: string } | null,
  loading: false,
}));

vi.mock("../../app/providers/AuthProvider", () => ({
  useAuth: () => authState,
}));

vi.mock("../../features/auth/api", () => ({
  login: vi.fn(),
}));

describe("LoginPage", () => {
  beforeEach(() => {
    authState.user = null;
    authState.loading = false;
    vi.mocked(login).mockReset();
  });

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

  it("opens the linked response with a welcome toast even when auth state updates during login", async () => {
    vi.mocked(login).mockImplementationOnce(async () => {
      authState.user = { id: "user-1" };
      return "Анна Иванова";
    });
    const from = {
      pathname: "/dashboard/forms/form-id/responses",
      search: "?response=answer-id",
      hash: "#details",
    };
    function Destination() {
      const { search, hash, state } = useLocation();
      const toast = (state as { toast?: string } | null)?.toast ?? "";
      return <p>{`${search}${hash}|${toast}`}</p>;
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
    expect(await screen.findByText("?response=answer-id#details|Добро пожаловать, Анна Иванова")).toBeInTheDocument();
  });

  it("renders updated heading, stretched submit button, password visibility toggle, and password-manager attributes", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>,
    );

    expect(screen.getByRole("heading", { name: "Вход в систему" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Авторизация" })).not.toBeInTheDocument();
    expect(container.querySelector(".login-card")).toBeInTheDocument();
    expect(container.querySelector(".login-form")).toHaveAttribute("method", "post");
    expect(container.querySelector(".login-fields")).toBeInTheDocument();

    const submitButton = screen.getByRole("button", { name: "Войти" });
    expect(submitButton).toHaveClass("button-primary", "login-submit-button");

    const emailInput = screen.getByLabelText("Электронная почта");
    const passwordInput = screen.getByLabelText("Пароль", { exact: true });
    expect(emailInput).toHaveAttribute("name", "email");
    expect(emailInput).toHaveAttribute("type", "email");
    expect(emailInput).toHaveAttribute("autocomplete", "username");
    expect(passwordInput).toHaveAttribute("name", "password");
    expect(passwordInput).toHaveAttribute("type", "password");
    expect(passwordInput).toHaveAttribute("autocomplete", "current-password");

    const toggle = screen.getByRole("button", { name: "Показать пароль" });
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    expect(toggle).toHaveAttribute("aria-controls", passwordInput.id);

    await user.click(passwordInput);
    await user.paste("pasted-secret-password");
    expect(passwordInput).toHaveValue("pasted-secret-password");

    await user.click(toggle);
    expect(passwordInput).toHaveAttribute("type", "text");
    expect(screen.getByRole("button", { name: "Скрыть пароль" })).toHaveAttribute("aria-pressed", "true");

    await user.click(screen.getByRole("button", { name: "Скрыть пароль" }));
    expect(passwordInput).toHaveAttribute("type", "password");
  });

  it("validates empty and malformed inputs before calling login and clears errors when edited", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>,
    );

    const emailInput = screen.getByLabelText("Электронная почта");
    const passwordInput = screen.getByLabelText("Пароль", { exact: true });
    const submitButton = screen.getByRole("button", { name: "Войти" });

    await user.click(submitButton);
    expect(emailInput).toHaveFocus();
    expect(emailInput).toHaveAttribute("aria-invalid", "true");
    expect(emailInput).toHaveAccessibleDescription("Укажите электронную почту.");
    expect(login).not.toHaveBeenCalled();

    await user.type(emailInput, "not-an-email");
    expect(emailInput).not.toHaveAttribute("aria-invalid");
    await user.click(submitButton);
    expect(emailInput).toHaveFocus();
    expect(emailInput).toHaveAccessibleDescription("Укажите корректный адрес электронной почты.");
    expect(login).not.toHaveBeenCalled();

    await user.clear(emailInput);
    await user.type(emailInput, "user@example.com");
    await user.click(submitButton);
    expect(passwordInput).toHaveFocus();
    expect(passwordInput).toHaveAttribute("aria-invalid", "true");
    expect(passwordInput).toHaveAccessibleDescription("Введите пароль.");
    expect(login).not.toHaveBeenCalled();
  });

  it("shows localized API auth errors and clears them when the user edits credentials", async () => {
    vi.mocked(login)
      .mockRejectedValueOnce(Object.assign(new Error("User is banned"), { code: "user_banned", status: 400 }))
      .mockRejectedValueOnce(new Error("Invalid login credentials"));
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>,
    );

    const emailInput = screen.getByLabelText("Электронная почта");
    const passwordInput = screen.getByLabelText("Пароль", { exact: true });
    const submitButton = screen.getByRole("button", { name: "Войти" });

    await user.type(emailInput, "disabled@example.com");
    await user.type(passwordInput, "password1234");
    await user.click(submitButton);
    expect(await screen.findByRole("alert")).toHaveTextContent("Учётная запись отключена. Обратитесь к администратору.");

    await user.type(passwordInput, "!");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    await user.click(submitButton);
    expect(await screen.findByRole("alert")).toHaveTextContent("Неверная почта или пароль.");
  });

  it("keeps the sign-in surface neutral regardless of the saved application theme and keeps submit button height stable on hover", () => {
    const css = readAppCss();
    const interfaceCss = readFileSync(resolve(process.cwd(), "src/interface.css"), "utf8");

    expect(css).toMatch(/\.app-shell-login,[^{]+\.app-shell-login\.app-shell-monochrome,[^{]+\.app-shell-login \.app-main-login\s*\{[^}]*color:\s*#18181b;[^}]*background:\s*var\(--survey-page-backdrop\)\s*!important;[^}]*color-scheme:\s*light;/s);
    expect(css).toMatch(/\.app-shell-login \.login-card\s*\{[^}]*color:\s*#18181b;[^}]*border-color:\s*#d4d4d8;[^}]*background:\s*#ffffff;/s);
    expect(css).toMatch(/\.login-submit-button\s*\{[^}]*width:\s*100%;/s);
    expect(interfaceCss).toMatch(/:root \.app-shell-login \.login-submit-button,\s*:root \.app-shell-login \.login-submit-button:is\(:hover,\s*:focus-visible\)\s*\{\s*width:\s*100%;\s*min-height:\s*44px;\s*\}/s);
  });
});
