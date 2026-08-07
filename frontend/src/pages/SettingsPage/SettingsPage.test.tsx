import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import SettingsPage from "./SettingsPage";

const { getSmtpSettings, saveSmtpSettings, showToast } = vi.hoisted(() => ({
  getSmtpSettings: vi.fn(),
  saveSmtpSettings: vi.fn(),
  showToast: vi.fn(),
}));

vi.mock("../../entities/mail/api", () => ({
  getSmtpSettings,
  saveSmtpSettings,
  queueTestEmail: vi.fn(),
  getMailBatchActivity: vi.fn(),
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
});
