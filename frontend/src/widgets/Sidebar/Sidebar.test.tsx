import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { Sidebar } from "./Sidebar";

vi.mock("../../app/providers/AuthProvider", () => ({
  useAuth: () => ({
    user: { id: "user-1", email: "lead@example.com" },
    profile: { role: "admin", name: "Руководитель" },
    loading: false,
  }),
}));

describe("Sidebar", () => {
  it("renders the redesigned brand, nav, and account areas", () => {
    render(
      <MemoryRouter>
        <Sidebar onToggle={() => undefined} />
      </MemoryRouter>,
    );

    expect(screen.getByText("Рабочее пространство")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Все формы" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Пользователи" })).toBeInTheDocument();
    expect(screen.getByText("Руководитель")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Выйти" })).toBeInTheDocument();
  });
});
