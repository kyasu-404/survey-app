import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import OrganizationsPage from "./OrganizationsPage";

const {
  authState,
  createOrganization,
  deleteAllOrganizations,
  deleteOrganization,
  exportOrganizationsXlsx,
  getOrganizations,
  importOrganizations,
  parseOrganizationsXlsx,
  showToast,
  updateOrganization,
} = vi.hoisted(() => ({
  authState: { profile: { role: "admin" } as { role: string } | null },
  createOrganization: vi.fn(),
  deleteAllOrganizations: vi.fn(),
  deleteOrganization: vi.fn(),
  exportOrganizationsXlsx: vi.fn(),
  getOrganizations: vi.fn(),
  importOrganizations: vi.fn(),
  parseOrganizationsXlsx: vi.fn(),
  showToast: vi.fn(),
  updateOrganization: vi.fn(),
}));

vi.mock("../../app/providers/AuthProvider", () => ({ useAuth: () => authState }));
vi.mock("../../app/providers/ToastProvider", () => ({ useToast: () => ({ showToast }) }));
vi.mock("../../entities/organization/api", () => ({
  createOrganization,
  deleteAllOrganizations,
  deleteOrganization,
  getOrganizations,
  importOrganizations,
  updateOrganization,
}));
vi.mock("../../entities/organization/xlsx", () => ({
  exportOrganizationsXlsx,
  parseOrganizationsXlsx,
}));

const organizations = [
  {
    id: "org-1",
    organization_type: "school",
    number: "123",
    alias: "ГБОУ",
    email: "school@example.ru",
    created_at: "2026-08-03T00:00:00.000Z",
    updated_at: "2026-08-03T00:00:00.000Z",
  },
  {
    id: "org-2",
    organization_type: "udod",
    number: null,
    alias: "ДДТ",
    email: "ddt@example.ru",
    created_at: "2026-08-03T00:00:00.000Z",
    updated_at: "2026-08-03T00:00:00.000Z",
  },
];

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <OrganizationsPage />
    </QueryClientProvider>,
  );
}

describe("OrganizationsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authState.profile = { role: "admin" };
    getOrganizations.mockResolvedValue(organizations);
    updateOrganization.mockResolvedValue(organizations[1]);
  });

  it("shows directory filters and the requested table columns", async () => {
    renderPage();

    expect(await screen.findByRole("heading", { name: "Справочник ОУ" })).toBeInTheDocument();
    ["Все", "Школы", "Сады", "ОДО", "УДОДы"].forEach((name) => {
      expect(screen.getByRole("tab", { name })).toBeInTheDocument();
    });
    await screen.findByText("ГБОУ");
    expect(screen.getByRole("button", { name: "Добавить +" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Импорт XLSX/ })).toHaveClass("organizations-file-button");
    expect(screen.getByRole("button", { name: /Импорт XLSX/ }).querySelector("img.toolbar-icon")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Экспорт XLSX/ })).toHaveClass("organizations-file-button");
    expect(screen.getByRole("button", { name: /Удалить все/ })).toHaveClass("organizations-delete-all-button");
    ["Тип ОУ", "Номер", "Алиасы", "Email", "Действия"].forEach((name) => {
      expect(screen.getByRole("columnheader", { name })).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole("tab", { name: "УДОДы" }));
    expect(screen.getByText("ДДТ")).toBeInTheDocument();
    expect(screen.queryByText("ГБОУ")).not.toBeInTheDocument();
  });

  it("disables the number field for UDOD and saves changes through the edit modal", async () => {
    renderPage();
    const row = await screen.findByRole("row", { name: /ДДТ/ });
    await userEvent.click(within(row).getByRole("button", { name: /Изменить/ }));

    const dialog = screen.getByRole("dialog", { name: "Изменение организации" });
    expect(within(dialog).getByLabelText("Номер")).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText("Алиас"), { target: { value: "Дом творчества" } });
    await userEvent.click(within(dialog).getByRole("button", { name: "Сохранить" }));

    await waitFor(() => expect(updateOrganization).toHaveBeenCalledWith("org-2", {
      organization_type: "udod",
      number: null,
      alias: "Дом творчества",
      email: "ddt@example.ru",
    }));
  });

  it("keeps destructive directory actions unavailable to non-admin users", async () => {
    authState.profile = { role: "user" };
    renderPage();

    await screen.findByText("ГБОУ");
    expect(screen.getByRole("button", { name: /Импорт XLSX/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Удалить все/ })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Добавить +" })).not.toBeInTheDocument();
  });
});
