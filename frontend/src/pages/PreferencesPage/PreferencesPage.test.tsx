import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import PreferencesPage from "./PreferencesPage";

const { updateCurrentUserPassword } = vi.hoisted(() => ({ updateCurrentUserPassword: vi.fn() }));
vi.mock("../../shared/api", () => ({ apiClient: { auth: { updateCurrentUserPassword } } }));
vi.mock("../../app/providers/AuthProvider", () => ({ useAuth: () => ({ user: { id: "viewer" } }) }));
vi.mock("../../app/providers/ToastProvider", () => ({ useToast: () => ({ showToast: vi.fn() }) }));
vi.mock("../../entities/notification/api", () => ({
  getNotificationPreferences: vi.fn().mockResolvedValue(["response_received"]),
  saveNotificationPreferences: vi.fn().mockResolvedValue(undefined),
}));

function renderSettings(path = "/preferences") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<MemoryRouter initialEntries={[path]}><QueryClientProvider client={client}>
    <PreferencesPage />
  </QueryClientProvider></MemoryRouter>);
  return userEvent.setup();
}

const oldPassword = "test-current-password";
const newPassword = "test-changed-password";
const securityPath = "/preferences?tab=security";

describe("personal settings", () => {
  beforeEach(() => {
    updateCurrentUserPassword.mockReset();
  });

  it("shows notifications first and opens the password form with keyboard navigation", async () => {
    const user = renderSettings();
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map(tab => tab.textContent)).toEqual(["Уведомления", "Безопасность"]);
    expect(tabs[0]).toHaveAttribute("aria-selected", "true");
    expect(await screen.findByRole("checkbox", { name: "Новые ответы" })).not.toBeChecked();

    tabs[0].focus();
    await user.keyboard("{ArrowRight}");
    expect(tabs[1]).toHaveFocus();
    const panel = screen.getByRole("tabpanel", { name: "Безопасность" });
    expect(within(panel).getByLabelText("Текущий пароль")).toHaveAttribute("autocomplete", "current-password");
    expect(within(panel).getByLabelText("Новый пароль", { exact: true })).toHaveAttribute("autocomplete", "new-password");
  });

  it("explains missing fields, short and mismatched passwords without submitting them", async () => {
    const user = renderSettings(securityPath);
    const current = screen.getByLabelText("Текущий пароль");
    const password = screen.getByLabelText("Новый пароль", { exact: true });
    const confirmation = screen.getByLabelText("Повторите новый пароль");
    const submit = screen.getByRole("button", { name: "Сменить пароль" });
    await user.click(submit);
    expect(current).toHaveFocus();
    expect(current).toHaveAccessibleDescription("Укажите текущий пароль.");
    await user.type(current, oldPassword);
    await user.type(password, "short");
    await user.click(submit);
    expect(password).toHaveAccessibleDescription(/не менее 12 символов/);
    await user.clear(password);
    await user.type(password, newPassword);
    await user.type(confirmation, "mismatch-password");
    await user.click(submit);
    expect(confirmation).toHaveAccessibleDescription("Пароли не совпадают.");
    expect(updateCurrentUserPassword).not.toHaveBeenCalled();
  });

  it("enforces the UTF-8 limit and explains a rate-limited auth response", async () => {
    updateCurrentUserPassword.mockResolvedValueOnce({ error: { status: 429 } });
    const user = renderSettings(securityPath);
    const current = screen.getByLabelText("Текущий пароль");
    const password = screen.getByLabelText("Новый пароль", { exact: true });
    const confirmation = screen.getByLabelText("Повторите новый пароль");
    const submit = screen.getByRole("button", { name: "Сменить пароль" });
    const byteLimit = "я".repeat(36);
    await user.type(current, oldPassword);
    await user.type(password, byteLimit + "!");
    await user.type(confirmation, byteLimit + "!");
    await user.click(submit);
    expect(password).toHaveAccessibleDescription(/не более 72 байт/);
    expect(updateCurrentUserPassword).not.toHaveBeenCalled();

    await user.type(password, "{Backspace}");
    await user.type(confirmation, "{Backspace}");
    await user.click(submit);
    expect(await screen.findByRole("alert")).toHaveTextContent("Слишком много попыток.");
    expect(updateCurrentUserPassword).toHaveBeenCalledWith(oldPassword, byteLimit);
    expect(submit).toBeEnabled();
  });

  it("reports a rejected current password, then changes it and clears the form", async () => {
    updateCurrentUserPassword.mockResolvedValueOnce({ error: { code: "current_password_invalid" } }).mockResolvedValueOnce({ error: null });
    const user = renderSettings(securityPath);
    const current = screen.getByLabelText("Текущий пароль");
    const password = screen.getByLabelText("Новый пароль", { exact: true });
    const confirmation = screen.getByLabelText("Повторите новый пароль");
    const submit = screen.getByRole("button", { name: "Сменить пароль" });
    await user.type(current, "test-incorrect-password");
    await user.type(password, newPassword);
    await user.type(confirmation, newPassword);
    await user.click(submit);
    expect(await screen.findByRole("alert")).toHaveTextContent("Текущий пароль указан неверно.");
    expect(current).toHaveValue("");
    expect(password).toHaveValue(newPassword);

    await user.type(current, oldPassword);
    await user.click(submit);
    expect(await screen.findByRole("status")).toHaveTextContent("Пароль изменён.");
    expect(updateCurrentUserPassword.mock.calls[1]).toEqual([oldPassword, newPassword]);
    expect(current).toHaveValue("");
    expect(password).toHaveValue("");
    expect(confirmation).toHaveValue("");
  });
});
