import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import AnnouncementsPage from "./AnnouncementsPage";

vi.mock("../../shared/config/env", () => ({ SUPABASE_URL: "https://supabase.test", SUPABASE_ANON_KEY: "test-key" }));
vi.mock("../../app/providers/AuthProvider", () => ({ useAuth: () => ({ user: { id: "admin" } }) }));
vi.mock("../../app/providers/ToastProvider", () => ({ useToast: () => ({ showToast: vi.fn() }) }));

const row = {
  id: "original", created_at: "2025-01-02T10:00:00Z", updated_at: "2025-01-03T10:12:34Z",
  publish_at: "2025-01-03T10:00:00Z", status: "published", audience_count: 11, familiar_count: 7,
  title: "Новое расписание", message: "Подробности", audience: "all", display_mode: "feed",
  action_url: null, action_label: null, require_acknowledgement: false, expires_at: null,
};
function renderPage() {
  const requests: { path: string; body: Record<string, unknown> }[] = [];
  vi.stubGlobal("fetch", async (input: string | URL, init: RequestInit) => {
    const path = new URL(input).pathname.split("/").pop()!;
    const body = JSON.parse(String(init.body));
    requests.push({ path, body });
    if (path === "list_admin_announcements") return Response.json(body.p_status === "published" ? [row] : []);
    if (path === "save_announcement" || path === "change_announcement") return Response.json(row.id);
    throw new Error("Unexpected request: " + path);
  });
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <AnnouncementsPage />
  </QueryClientProvider>);
  return { user: userEvent.setup(), requests };
}

describe("Административные объявления", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("сохраняет версию и исходную дату публикации при редактировании", async () => {
    const { user, requests } = renderPage();
    await user.click(screen.getByRole("tab", { name: "Опубликованные" }));
    await user.click(await screen.findByRole("button", { name: row.title }));
    const editor = within(screen.getByRole("dialog"));
    await user.type(editor.getByLabelText("Текст объявления"), " **обновлены**");
    await user.click(editor.getByRole("tab", { name: "Предпросмотр" }));
    expect(editor.getByText("обновлены", { selector: "strong" })).toBeVisible();
    await user.click(editor.getByRole("button", { name: "Сохранить изменения" }));
    await waitFor(() => expect(requests.find(r => r.path === "save_announcement")?.body).toMatchObject({
      p_id: row.id, p_expected_updated_at: row.updated_at, p_publication: "keep", p_publish_at: null,
      p_fields: { message: "Подробности **обновлены**", expires_at: null },
    }));
  });

  it.each([
    ["Дублировать", "duplicate", "Черновики"],
    ["Снять с публикации", "withdraw", "Черновики"],
    ["Архивировать", "archive", "Архивные"],
  ])("выполняет действие «%s» для показанной версии объявления", async (label, action, tab) => {
    const { user, requests } = renderPage();
    await user.click(screen.getByRole("tab", { name: "Опубликованные" }));
    await user.click(await screen.findByRole("button", { name: /Действия объявления/ }));
    await user.click(screen.getByRole("button", { name: label }));
    if (action === "archive") {
      await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Архивировать" }));
    }
    await waitFor(() => expect(requests.find(r => r.path === "change_announcement")?.body).toEqual({
      p_id: row.id, p_action: action, p_expected_updated_at: row.updated_at,
    }));
    expect(await screen.findByRole("tab", { name: tab, selected: true })).toBeVisible();
  });

  it.each(["schedule", "publish"])("проверяет даты и публикует в режиме %s", async (publication) => {
    const { user, requests } = renderPage();
    await user.click(screen.getByRole("button", { name: "Создать объявление" }));
    const editor = within(screen.getByRole("dialog"));
    await user.type(editor.getByLabelText("Заголовок"), "Технические работы");
    await user.type(editor.getByLabelText("Текст объявления"), "Обновление приложения");
    await user.selectOptions(editor.getByLabelText("Аудитория"), "user");
    await user.selectOptions(editor.getByLabelText("Способ отображения"), "banner");
    await user.click(editor.getByLabelText("Запросить подтверждение ознакомления"));
    await user.selectOptions(editor.getByLabelText("Состояние публикации"), publication);
    const scheduled = publication === "schedule";
    if (scheduled) {
      fireEvent.change(editor.getByLabelText("Дата публикации"), { target: { value: "2099-11-30T15:00" } });
      fireEvent.change(editor.getByLabelText(/Окончание действия/), { target: { value: "2099-11-29T15:00" } });
      await user.click(editor.getByRole("button", { name: "Запланировать" }));
      expect(editor.getByRole("alert")).toHaveTextContent(/позже/);
      expect(requests.some(r => r.path === "save_announcement")).toBe(false);
      fireEvent.change(editor.getByLabelText(/Окончание действия/), { target: { value: "2099-12-01T15:00" } });
    }
    await user.click(editor.getByRole("button", { name: scheduled ? "Запланировать" : "Опубликовать" }));
    await waitFor(() => expect(requests.find(r => r.path === "save_announcement")?.body).toMatchObject({
      p_id: null, p_expected_updated_at: null, p_publication: publication,
      p_publish_at: scheduled ? new Date("2099-11-30T15:00").toISOString() : null,
      p_fields: { expires_at: scheduled ? new Date("2099-12-01T15:00").toISOString() : null,
        audience: "user", display_mode: "banner", require_acknowledgement: true },
    }));
    expect(await screen.findByRole("tab", { name: scheduled ? "Запланированные" : "Опубликованные", selected: true })).toBeVisible();
  });
});
