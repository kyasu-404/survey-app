import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import UsersPage from "./UsersPage";

const {
  getAllUsers,
  createUser,
  deleteUser,
  setUserDisabled,
  updateUserRole,
  updateMyPassword,
  updateUserPassword,
  showToast,
} = vi.hoisted(() => ({
  getAllUsers: vi.fn(),
  createUser: vi.fn(),
  deleteUser: vi.fn(),
  setUserDisabled: vi.fn(),
  updateUserRole: vi.fn(),
  updateMyPassword: vi.fn(),
  updateUserPassword: vi.fn(),
  showToast: vi.fn(),
}));

vi.mock("../../features/users/api", () => ({
  createUser,
  deleteUser,
  getAllUsers,
  setUserDisabled,
  updateUserRole,
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

function readAppCss() {
  return readFileSync(join(process.cwd(), "src/app.css"), "utf8");
}

describe("UsersPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    updateUserRole.mockResolvedValue(undefined);
    setUserDisabled.mockResolvedValue(undefined);
  });

  it("renders a loading label with a spinner while users are loading", async () => {
    let resolveUsers!: (value: []) => void;
    getAllUsers.mockImplementation(
      () =>
        new Promise<[]>((resolve) => {
          resolveUsers = resolve;
        }),
    );

    const { container } = render(
      <QueryClientProvider client={createQueryClient()}>
        <UsersPage />
      </QueryClientProvider>,
    );

    expect(await screen.findByText("Загрузка пользователей")).toBeInTheDocument();
    expect(container.querySelector(".users-page-status .inline-spinner")).toBeInTheDocument();
    expect(container.querySelector(".users-table-skeleton")).not.toBeInTheDocument();

    resolveUsers([]);
  });

  it("renders the merged users controls block and search field above the table", async () => {
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
    expect(container.querySelector(".users-page-controls")).toBeInTheDocument();
    expect(container.querySelector(".users-page-controls .users-create-grid")).toBeInTheDocument();
    expect(container.querySelector(".users-page-controls .users-page-toolbar")).toBeInTheDocument();
    expect(container.querySelector(".users-table-shell")).toBeInTheDocument();

    const searchField = screen.getByRole("searchbox", { name: "Поиск по имени" });
    expect(searchField).toHaveAttribute("placeholder", "Введите имя для поиска");
    expect(container.querySelector(".users-search-field .users-search-icon")).toBeInTheDocument();

    const controls = container.querySelector(".users-page-controls");
    const filters = container.querySelector(".users-filters-grid");
    const tableShell = container.querySelector(".users-table-shell");

    expect(controls).not.toBeNull();
    expect(filters).not.toBeNull();
    expect(tableShell).not.toBeNull();

    if (!controls || !filters || !tableShell) {
      throw new Error("Expected users page layout nodes to be present");
    }

    expect(controls.compareDocumentPosition(filters) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(filters.compareDocumentPosition(tableShell) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("renders the users table shell without rounded corners", () => {
    const css = readAppCss();

    expect(css).toMatch(/\.users-table-shell\s*\{[^}]*border-radius:\s*0;/);
  });

  it("centers user modal headings", () => {
    const css = readAppCss();

    expect(css).toMatch(/\.dashboard-delete-modal-title,\s*\.users-modal-title\s*\{[^}]*text-align:\s*center;/);
  });

  it("filters users by name, role, and status", async () => {
    getAllUsers.mockResolvedValue([
      {
        id: "user-1",
        name: "Администратор",
        email: "admin@example.com",
        role: "admin",
        is_disabled: false,
        created_at: "2026-04-08T09:00:00.000Z",
      },
      {
        id: "user-2",
        name: "Мария",
        email: "maria@example.com",
        role: "user",
        is_disabled: false,
        created_at: "2026-04-08T09:10:00.000Z",
      },
      {
        id: "user-3",
        name: "Павел",
        email: "pavel@example.com",
        role: "admin",
        is_disabled: true,
        created_at: "2026-04-08T09:20:00.000Z",
      },
    ]);

    render(
      <QueryClientProvider client={createQueryClient()}>
        <UsersPage />
      </QueryClientProvider>,
    );

    expect(await screen.findByText("Мария")).toBeInTheDocument();
    expect(screen.getByText("Павел")).toBeInTheDocument();

    const searchField = screen.getByRole("searchbox", { name: "Поиск по имени" });
    const searchFieldShell = searchField.closest(".users-search-field");
    expect(searchFieldShell).not.toBeNull();
    expect(searchFieldShell?.querySelector(".users-search-icon")).toBeInTheDocument();

    await userEvent.type(searchField, "ма");

    expect(screen.getByText("Мария")).toBeInTheDocument();
    expect(screen.queryByText("Павел")).not.toBeInTheDocument();

    await userEvent.clear(searchField);
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Фильтр по роли" }), "admin");
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Фильтр по статусу" }), "disabled");

    expect(screen.getByText("Павел")).toBeInTheDocument();
    expect(screen.queryByText("Мария")).not.toBeInTheDocument();
  });

  it("renders user roles as static labels and toggles status from the status column", async () => {
    getAllUsers.mockResolvedValue([
      {
        id: "user-1",
        name: "Администратор",
        email: "admin@example.com",
        role: "admin",
        is_disabled: false,
        created_at: "2026-04-08T09:00:00.000Z",
      },
      {
        id: "user-2",
        name: "Мария",
        email: "maria@example.com",
        role: "user",
        is_disabled: false,
        created_at: "2026-04-08T09:10:00.000Z",
      },
    ]);

    render(
      <QueryClientProvider client={createQueryClient()}>
        <UsersPage />
      </QueryClientProvider>,
    );

    expect(await screen.findByText("Мария")).toBeInTheDocument();

    const mariaRow = screen.getByText("Мария").closest("tr");
    expect(mariaRow).not.toBeNull();

    if (!mariaRow) {
      throw new Error("Expected Maria row to be present");
    }

    expect(screen.queryByRole("button", { name: "Роль пользователя Администратор: admin" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Роль пользователя Мария: user" })).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Изменить роль пользователя Мария" })).not.toBeInTheDocument();
    expect(within(mariaRow).getByText("user")).toHaveClass("users-role-chip");

    await userEvent.click(screen.getByRole("button", { name: "Статус пользователя Мария: Активен" }));

    await waitFor(() => {
      expect(setUserDisabled).toHaveBeenCalledWith("user-2", true);
    });

    expect(updateUserRole).not.toHaveBeenCalled();
  });

  it("uses red destructive controls, yellow password controls, and black cancel controls", async () => {
    getAllUsers.mockResolvedValue([
      {
        id: "user-1",
        name: "Администратор",
        email: "admin@example.com",
        role: "admin",
        is_disabled: false,
        created_at: "2026-04-08T09:00:00.000Z",
      },
      {
        id: "user-2",
        name: "Мария",
        email: "maria@example.com",
        role: "user",
        is_disabled: false,
        created_at: "2026-04-08T09:10:00.000Z",
      },
    ]);

    render(
      <QueryClientProvider client={createQueryClient()}>
        <UsersPage />
      </QueryClientProvider>,
    );

    expect(await screen.findByText("Мария")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Сменить мой пароль" })).toHaveClass("users-yellow-button");

    await userEvent.click(screen.getByRole("button", { name: "Сменить мой пароль" }));
    expect(screen.getByRole("heading", { name: "Смена моего пароля" })).toHaveClass("users-modal-title");
    await userEvent.click(screen.getByRole("button", { name: "Отмена" }));

    const mariaRow = screen.getByText("Мария").closest("tr");
    expect(mariaRow).not.toBeNull();

    if (!mariaRow) {
      throw new Error("Expected Maria row to be present");
    }

    expect(within(mariaRow).getByRole("button", { name: "Сменить пароль" })).toHaveClass("users-yellow-button");
    expect(within(mariaRow).getByRole("button", { name: "Удалить" })).toHaveClass("users-danger-button");

    await userEvent.click(within(mariaRow).getByRole("button", { name: "Удалить" }));

    expect(screen.getByRole("heading", { name: "Удаление пользователя" })).toHaveClass("users-modal-title");
    expect(screen.getByText(/Внимание:/)).toHaveClass("users-modal-copy-danger");
    expect(screen.getByRole("button", { name: "Отмена" })).toHaveClass("users-neutral-button");
    expect(screen.getByRole("button", { name: "Удалить пользователя" })).toHaveClass("users-danger-button");

    await userEvent.click(screen.getByRole("button", { name: "Отмена" }));
    await userEvent.click(within(mariaRow).getByRole("button", { name: "Сменить пароль" }));

    expect(screen.getByRole("heading", { name: "Смена пароля: Мария" })).toHaveClass("users-modal-title");
    expect(screen.getByRole("button", { name: "Отмена" })).toHaveClass("users-neutral-button");
    expect(screen.getByRole("button", { name: "Сохранить" })).toHaveClass("users-yellow-button");
  });
});
