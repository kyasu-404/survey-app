import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import UsersPage from "./UsersPage";

const {
  getAllUsers,
  createUser,
  deleteUser,
  setUserDisabled,
  updateMyPassword,
  updateUserPassword,
  showToast,
} = vi.hoisted(() => ({
  getAllUsers: vi.fn(),
  createUser: vi.fn(),
  deleteUser: vi.fn(),
  setUserDisabled: vi.fn(),
  updateMyPassword: vi.fn(),
  updateUserPassword: vi.fn(),
  showToast: vi.fn(),
}));

vi.mock("../../features/users/api", () => ({
  createUser,
  deleteUser,
  getAllUsers,
  setUserDisabled,
  updateMyPassword,
  updateUserPassword,
}));

vi.mock("../../app/providers/ToastProvider", () => ({
  useToast: () => ({
    showToast,
  }),
}));

vi.mock("../../app/providers/AuthProvider", () => ({
  useAuth: () => ({
    user: { id: "user-1" },
    loading: false,
  }),
}));

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: { retry: false },
    },
  });
}

describe("UsersPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders reusable users workspace hooks", async () => {
    getAllUsers.mockResolvedValue([
      {
        id: "user-1",
        name: "Администратор",
        email: "admin@example.com",
        role: "admin",
        is_disabled: false,
        created_at: "2026-04-08T09:00:00.000Z",
      },
    ]);

    const { container } = render(
      <QueryClientProvider client={createQueryClient()}>
        <UsersPage />
      </QueryClientProvider>,
    );

    expect(await screen.findByRole("heading", { name: "Пользователи" })).toBeInTheDocument();
    expect(await screen.findByText("admin@example.com")).toBeInTheDocument();
    expect(container.querySelector(".users-page-card")).toBeInTheDocument();
    expect(container.querySelector(".users-page-toolbar")).toBeInTheDocument();
    expect(container.querySelector(".users-table-shell")).toBeInTheDocument();
  });
});
