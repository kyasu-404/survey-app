import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import LoginPage from "./LoginPage";

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
});
