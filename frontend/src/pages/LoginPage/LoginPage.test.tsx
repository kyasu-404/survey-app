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
});
