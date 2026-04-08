import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import LoginPage from "./LoginPage";

const { login } = vi.hoisted(() => ({
  login: vi.fn(),
}));

vi.mock("../../app/providers/AuthProvider", () => ({
  useAuth: () => ({
    user: null,
    loading: false,
  }),
}));

vi.mock("../../features/auth/api", () => ({
  login,
}));

describe("LoginPage", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("renders the redesigned login showcase and shows a login error", async () => {
    const user = userEvent.setup();
    login.mockRejectedValueOnce(new Error("Invalid login credentials"));

    render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>,
    );

    expect(screen.getByText("Формы для команды")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Авторизация" })).toBeInTheDocument();

    await user.type(screen.getByPlaceholderText("Электронная почта"), "ivan@example.com");
    await user.type(screen.getByPlaceholderText("Пароль"), "secret");
    await user.click(screen.getByRole("button", { name: "Войти" }));

    expect(login).toHaveBeenCalledWith("ivan@example.com", "secret");

    expect(await screen.findByText("Неверный логин или пароль")).toBeInTheDocument();
  });
});
