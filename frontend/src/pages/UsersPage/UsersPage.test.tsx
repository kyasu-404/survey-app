import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import UsersPage from "./UsersPage";

const { showToast, getAllUsers } = vi.hoisted(() => ({
  showToast: vi.fn(),
  getAllUsers: vi.fn(),
}));

vi.mock("../../app/providers/AuthProvider", () => ({
  useAuth: () => ({
    user: { id: "user-1" },
    loading: false,
  }),
}));

vi.mock("../../app/providers/ToastProvider", () => ({
  useToast: () => ({
    showToast,
  }),
}));

vi.mock("../../features/users/api", () => ({
  createUser: vi.fn(),
  deleteUser: vi.fn(),
  getAllUsers,
  setUserDisabled: vi.fn(),
  updateMyPassword: vi.fn(),
  updateUserPassword: vi.fn(),
}));

describe("UsersPage", () => {
  it("renders the modular admin layout with a dedicated creation module and status column", async () => {
    getAllUsers.mockResolvedValue([
      {
        id: "user-1",
        name: "Иван Петров",
        email: "ivan@example.com",
        role: "admin",
        is_disabled: false,
        created_at: "2026-04-08T10:00:00.000Z",
      },
    ]);

    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });

    render(
      <MemoryRouter>
        <QueryClientProvider client={queryClient}>
          <UsersPage />
        </QueryClientProvider>
      </MemoryRouter>,
    );

    expect(await screen.findByRole("heading", { name: "Пользователи" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Создание пользователя" })).toBeInTheDocument();
    expect(await screen.findByRole("columnheader", { name: "Статус" })).toBeInTheDocument();
  });
});
