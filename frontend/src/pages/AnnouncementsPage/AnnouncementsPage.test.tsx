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
function renderPage(published: Omit<typeof row, "expires_at" | "action_label" | "action_url"> & {
  expires_at: string | null; action_label: string | null; action_url: string | null;
} = row, handleSave?: (payload: Record<string, unknown>) => Response) {
  const requests: { path: string; body: Record<string, unknown> }[] = [];
  vi.stubGlobal("fetch", async (input: string | URL, init: RequestInit) => {
    const path = new URL(input).pathname.split("/").pop()!;
    const body = JSON.parse(String(init.body));
    requests.push({ path, body });
    if (path === "list_admin_announcements") return Response.json(body.p_status === "published" ? [published] : []);
    if (path === "save_announcement") return handleSave?.(body) ?? Response.json(row.id);
    if (path === "change_announcement") return Response.json(row.id);
    throw new Error("Unexpected request: " + path);
  });
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <AnnouncementsPage />
  </QueryClientProvider>);
  return { user: userEvent.setup(), requests };
}

describe("Административные объявления", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("ссылается на существующую панель с каждой вкладки", async () => {
    const { user } = renderPage();
    const assertPanels = (tablist: HTMLElement) => {
      for (const tab of within(tablist).getAllByRole("tab")) {
        const panel = document.getElementById(tab.getAttribute("aria-controls")!);
        expect(panel).toHaveAttribute("role", "tabpanel");
        expect(panel).toHaveAttribute("aria-labelledby", tab.id);
        expect(panel?.hidden).toBe(tab.getAttribute("aria-selected") === "false");
      }
    };

    const statuses = screen.getByRole("tablist", { name: "Статус объявления" });
    assertPanels(statuses);
    await user.click(within(statuses).getByRole("tab", { name: "Опубликованные" }));
    assertPanels(statuses);

    await user.click(await screen.findByRole("button", { name: row.title }));
    const modes = within(screen.getByRole("dialog")).getByRole("tablist", { name: "Режим редактора" });
    assertPanels(modes);
    await user.click(within(modes).getByRole("tab", { name: "Предпросмотр" }));
    assertPanels(modes);
  });

  it("показывает в предпросмотре ссылку с пробелами по краям и сохраняет очищенный адрес", async () => {
    const { user, requests } = renderPage({
      ...row, display_mode: "banner", action_label: "Документация", action_url: " /preferences ",
    });
    await user.click(screen.getByRole("tab", { name: "Опубликованные" }));
    await user.click(await screen.findByRole("button", { name: row.title }));
    const editor = within(screen.getByRole("dialog"));
    await user.click(editor.getByRole("tab", { name: "Предпросмотр" }));
    expect(editor.getAllByText("Документация", { selector: ".announcement-action" })).toHaveLength(2);
    await user.click(editor.getByRole("button", { name: "Сохранить изменения" }));
    await waitFor(() => expect(requests.find(r => r.path === "save_announcement")?.body).toMatchObject({
      p_fields: { action_url: "/preferences" },
    }));
  });

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

  it("keeps an expired publication in the archive when its text is edited", async () => {
    const expiry = "2026-01-02T10:00:00Z";
    const { user, requests } = renderPage({ ...row, expires_at: expiry });
    await user.click(screen.getByRole("tab", { name: "Опубликованные" }));
    await user.click(await screen.findByRole("button", { name: row.title }));
    const editor = within(screen.getByRole("dialog"));
    await user.type(editor.getByLabelText("Текст объявления"), "!");
    await user.click(editor.getByRole("button", { name: "Сохранить изменения" }));
    expect(await screen.findByRole("tab", { name: "Архивные", selected: true })).toBeVisible();
    expect(requests.find(r => r.path === "save_announcement")?.body).toMatchObject({ p_fields: { expires_at: expiry } });
  });

  it.each([
    ["Дублировать", "duplicate", "Черновики"],
    ["Снять с публикации", "withdraw", "Черновики"],
    ["Архивировать", "archive", "Архивные"],
  ])("выполняет действие «%s» для показанной версии объявления", async (label, action, tab) => {
    const { user, requests } = renderPage();
    await user.click(screen.getByRole("tab", { name: "Опубликованные" }));
    await user.click(await screen.findByRole("button", { name: /Действия объявления/ }));
    await user.click(screen.getByRole("menuitem", { name: label }));
    if (action === "archive") {
      const dialog = within(screen.getByRole("dialog", { name: "Архивировать объявление?" }));
      expect(dialog.getByRole("button", { name: "Отмена" })).toHaveFocus();
      await user.click(dialog.getByRole("button", { name: "Архивировать" }));
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
  it("rejects an incomplete end date when submitting from preview", async () => {
    const { user, requests } = renderPage({ ...row, expires_at: "2099-01-01T10:00:00Z" });
    await user.click(screen.getByRole("tab", { name: "Опубликованные" }));
    await user.click(await screen.findByRole("button", { name: row.title }));
    const editor = within(screen.getByRole("dialog"));
    const input = editor.getByLabelText("Окончание действия (необязательно)") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "" } });
    vi.spyOn(input, "validity", "get").mockReturnValue({ badInput: true } as ValidityState);

    await user.click(editor.getByRole("tab", { name: "Предпросмотр" }));
    await user.click(editor.getByRole("button", { name: "Сохранить изменения" }));
    expect(await editor.findByRole("alert")).toHaveTextContent("Проверьте дату и время");
    expect(requests.some(r => r.path === "save_announcement")).toBe(false);
  });

  it("can reload the current announcement after a conflicting update", async () => {
    const updated = { ...row };
    const { user, requests } = renderPage(updated, (payload) => {
      if (payload.p_expected_updated_at === row.updated_at) {
        Object.assign(updated, { title: "Изменено в другой вкладке", updated_at: "2025-01-04T12:00:00Z" });
        return Response.json({ code: "40001", message: "Conflict" }, { status: 409 });
      }
      return Response.json(row.id);
    });
    await user.click(screen.getByRole("tab", { name: "Опубликованные" }));
    await user.click(await screen.findByRole("button", { name: row.title }));
    const editor = within(screen.getByRole("dialog"));
    await user.type(editor.getByRole("textbox", { name: "Заголовок" }), " моя правка");
    await user.click(editor.getByRole("button", { name: "Сохранить изменения" }));
    expect(await editor.findByRole("alert")).toHaveTextContent("другой вкладке");
    expect(editor.getByRole("textbox", { name: "Заголовок" })).toHaveValue(`${row.title} моя правка`);
    await user.click(editor.getByRole("button", { name: "Сбросить правки и загрузить актуальную версию" }));
    await waitFor(() => expect(within(screen.getByRole("dialog")).getByRole("textbox", { name: "Заголовок" })).toHaveValue(updated.title));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Сохранить изменения" }));
    await waitFor(() => expect(requests.filter(r => r.path === "save_announcement").slice(-1)[0]?.body.p_expected_updated_at)
      .toBe(updated.updated_at));
  });

});
