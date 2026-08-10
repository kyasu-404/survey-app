import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import SettingsPage from "./SettingsPage";

const {
  getSmtpSettings,
  saveSmtpSettings,
  getStorageCleanupOverview,
  runStorageCleanup,
  showToast,
} = vi.hoisted(() => ({
  getSmtpSettings: vi.fn(),
  saveSmtpSettings: vi.fn(),
  getStorageCleanupOverview: vi.fn(),
  runStorageCleanup: vi.fn(),
  showToast: vi.fn(),
}));

vi.mock("../../entities/mail/api", () => ({
  getSmtpSettings,
  saveSmtpSettings,
  queueTestEmail: vi.fn(),
  getMailBatchActivity: vi.fn(),
}));

vi.mock("../../entities/maintenance/api", () => ({
  getStorageCleanupOverview,
  runStorageCleanup,
}));

vi.mock("../../app/providers/AuthProvider", () => ({
  useAuth: () => ({ profile: { email: "admin@example.ru" } }),
}));

vi.mock("../../app/providers/ToastProvider", () => ({
  useToast: () => ({ showToast }),
}));

vi.mock("../../shared/api", () => {
  const channel = { on: vi.fn(() => channel), subscribe: vi.fn(() => channel) };
  return { supabaseClient: { channel: vi.fn(() => channel), removeChannel: vi.fn() } };
});

const storedSettings = {
  enabled: true,
  host: "smtp.example.ru",
  port: 465,
  sslMode: "tls" as const,
  username: "mail@example.ru",
  fromEmail: "mail@example.ru",
  fromName: "Формы",
  replyTo: "",
  hasPassword: true,
  updatedAt: "2026-08-06T12:00:00.000Z",
};

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <SettingsPage />
    </QueryClientProvider>,
  );
}

describe("SettingsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSmtpSettings.mockResolvedValue(storedSettings);
    saveSmtpSettings.mockResolvedValue({ ...storedSettings, host: "smtp2.example.ru" });
    getStorageCleanupOverview.mockResolvedValue({ retentionHours: 168, lastRun: null });
    runStorageCleanup.mockResolvedValue({
      id: "11111111-1111-4111-8111-111111111111",
      triggerType: "manual",
      status: "succeeded",
      retentionHours: 168,
      removedFiles: 2,
      removedAssets: 1,
      error: null,
      startedAt: "2026-08-10T12:00:00.000Z",
      finishedAt: "2026-08-10T12:00:01.000Z",
    });
  });

  it("loads saved SMTP data without exposing the password and saves changes", async () => {
    renderPage();

    const host = await screen.findByRole("textbox", { name: "SMTP-сервер" });
    expect(host).toHaveValue("smtp.example.ru");
    expect(screen.getByText("Пароль сохранён")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("••••••••••••")).toHaveValue("");

    await userEvent.clear(host);
    await userEvent.type(host, "smtp2.example.ru");
    await userEvent.click(screen.getByRole("button", { name: "Сохранить настройки" }));

    await waitFor(() => expect(saveSmtpSettings).toHaveBeenCalledWith(expect.objectContaining({
      host: "smtp2.example.ru",
      password: "",
    })));
    expect(showToast).toHaveBeenCalledWith("Настройки SMTP сохранены", "success");
  });

  it("keeps the SMTP form visible when the server module is not deployed", async () => {
    getSmtpSettings.mockRejectedValue(new Error(
      "Почтовый модуль mail-admin не развёрнут в Supabase. Установите миграцию и модуль по инструкции в README.",
    ));

    renderPage();

    expect(await screen.findByRole("textbox", { name: "SMTP-сервер" })).toHaveValue("");
    expect(screen.getByRole("spinbutton", { name: "Порт" })).toHaveValue(465);
    expect(screen.getByRole("alert")).toHaveTextContent("Почтовый модуль mail-admin не развёрнут в Supabase");
    expect(screen.getByRole("button", { name: "Проверить снова" })).toBeInTheDocument();
  });

  it("visually separates SMTP settings from storage cleanup and runs manual cleanup after confirmation", async () => {
    renderPage();

    expect(await screen.findByRole("heading", { name: "SMTP-коннектор" })).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "Очистка файлов" })).toBeInTheDocument();
    expect(screen.getByText("Автоматически раз в сутки")).toBeInTheDocument();
    expect(screen.getByText(/Минимальный возраст — 7 дней/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Запустить очистку сейчас" }));
    expect(screen.getByRole("alertdialog", { name: "Запустить очистку файлов?" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Очистить" }));

    await waitFor(() => expect(runStorageCleanup).toHaveBeenCalledTimes(1));
    expect(showToast).toHaveBeenCalledWith(
      "Очистка завершена: файлов ответов — 2, изображений форм — 1",
      "success",
    );
  });

  it("keeps every editable settings field white in all application themes", () => {
    const css = readFileSync(join(process.cwd(), "src/app.css"), "utf8");

    expect(css).toMatch(
      /\.settings-page-card \.settings-field input:not\(\[type="checkbox"\]\),[\s\S]*\.settings-page-card \.settings-field select[\s\S]*\{[^}]*background:\s*#ffffff\s*!important;[^}]*color-scheme:\s*light;/,
    );
  });
});
