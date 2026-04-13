import { render, screen } from "@testing-library/react";
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

describe("Sidebar", () => {
  it("links to the templates gallery as a separate tab", () => {
    render(
      <MemoryRouter>
        <Sidebar onToggle={vi.fn()} />
      </MemoryRouter>,
    );

    expect(screen.getByRole("link", { name: "Шаблоны" })).toHaveAttribute("href", routes.templates);
  });
});
