import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../../entities/notification/api";
import type { Notification } from "../../entities/notification/model";
import NotificationsPage from "./NotificationsPage";

vi.mock("../../entities/notification/api");
vi.mock("../../app/providers/AuthProvider", () => ({ useAuth: () => ({ user: { id: "viewer" } }) }));
vi.mock("../../app/providers/ToastProvider", () => ({ useToast: () => ({ showToast: vi.fn() }) }));

function CurrentPath() { return <output>{useLocation().pathname}</output>; }
function openCenter() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>
    <MemoryRouter initialEntries={["/notifications"]}><NotificationsPage /><CurrentPath /></MemoryRouter>
  </QueryClientProvider>);
}

describe("notification center", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(api.getNotifications).mockResolvedValue({ items: [], next: undefined });
    vi.mocked(api.getUnreadCount).mockResolvedValue(0);
    vi.mocked(api.getNotificationPreferences).mockResolvedValue([]);
  });

  it("saves preferences in place and restores focus to the settings button", async () => {
    const user = userEvent.setup();
    openCenter();
    expect(await screen.findByText("Уведомлений пока нет")).toBeVisible();
    const category = within(screen.getByLabelText("Категория"));
    expect(category.queryByRole("option", { name: "Срабатывания правил" })).toBeNull();
    expect(category.queryByRole("option", { name: "Успешные отправки" })).toBeNull();
    expect(category.getByRole("option", { name: "Ошибки автоматизации" })).toBeInTheDocument();
    const settings = screen.getByRole("button", { name: "Настроить" });
    await user.click(settings);
    const dialog = await screen.findByRole("dialog", { name: "Настройки уведомлений" });
    await user.click(await within(dialog).findByRole("checkbox", { name: "Новые ответы" }));
    expect(within(dialog).queryByRole("checkbox", { name: "Объявления" })).toBeNull();
    expect(within(dialog).queryByRole("checkbox", { name: "Срабатывания правил" })).toBeNull();
    expect(within(dialog).queryByRole("checkbox", { name: "Успешные отправки" })).toBeNull();
    expect(within(dialog).getByRole("checkbox", { name: "Ошибки автоматизации" })).toBeChecked();
    await user.click(within(dialog).getByRole("button", { name: "Сохранить" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(vi.mocked(api.saveNotificationPreferences).mock.calls[0][0]).toEqual(["response_received"]);
    expect(settings).toHaveFocus();
    expect(screen.getByText("/notifications")).toBeVisible();
  });

  it("retries the failed page with its cursor and disables bulk read until the counter is available", async () => {
    const user = userEvent.setup();
    const cursor = { id: "first", created_at: "2026-11-22T08:00:00Z" };
    vi.mocked(api.getUnreadCount).mockImplementation(() => new Promise(() => {}));
    vi.mocked(api.getNotifications)
      .mockResolvedValueOnce({ items: [], next: cursor })
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({ items: [], next: undefined });
    openCenter();
    expect(screen.getByRole("button", { name: "Отметить все прочитанными" })).toBeDisabled();
    await user.click(await screen.findByRole("button", { name: "Показать ещё" }));
    await user.click(await screen.findByRole("button", { name: "Повторить" }));
    await waitFor(() => expect(vi.mocked(api.getNotifications).mock.calls.map(call => call[2])).toEqual([undefined, cursor, cursor]));
  });

  it("keeps a read announcement available for explicit acknowledgement and filters the feed", async () => {
    const user = userEvent.setup();
    const item: Notification = { id: "notice", title: "Технические работы", message: "**Пятница**", category: "announcement",
      created_at: "2026-11-22T08:00:00Z", read_at: null, form_id: null, rule_id: null, response_id: null,
      announcement: { require_acknowledgement: true, acknowledged_at: null, action_label: null, action_url: null, display_mode: "feed" } };
    vi.mocked(api.getNotifications).mockImplementation(async (category, read) => ({
      items: (category && category !== item.category) || (read === "unread" && item.read_at) ? [] : [{ ...item, announcement: { ...item.announcement! } }],
      next: undefined,
    }));
    vi.mocked(api.getUnreadCount).mockImplementation(async () => item.read_at ? 0 : 1);
    vi.mocked(api.markNotificationsRead).mockImplementation(async () => { item.read_at = "now"; });
    vi.mocked(api.acknowledgeAnnouncement).mockImplementation(async () => { item.announcement!.acknowledged_at = "now"; });
    openCenter();
    const feed = await screen.findByRole("list", { name: "Лента уведомлений" });
    const card = within(feed).getByRole("article", { name: item.title });
    expect(card).toHaveAttribute("data-unread", "true");
    expect(within(card).getByRole("img", { name: "Непрочитанное" })).toBeInTheDocument();
    expect(within(card).getByRole("time")).toHaveAttribute("datetime", item.created_at);
    expect(within(card).getByRole("button", { name: "Отметить прочитанным" })).toBeEnabled();
    await user.selectOptions(screen.getByLabelText("Категория"), "announcement");
    await user.click(screen.getByRole("button", { name: "Отметить все прочитанными" }));
    expect(await screen.findByText("Непрочитанных: 0")).toBeVisible();
    const readCard = screen.getByRole("article", { name: item.title });
    expect(readCard).toHaveAttribute("data-unread", "false");
    expect(within(readCard).queryByRole("button", { name: "Отметить прочитанным" })).toBeNull();
    expect(api.acknowledgeAnnouncement).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Ознакомился" }));
    expect(await screen.findByText("Ознакомление подтверждено")).toBeVisible();
    await user.selectOptions(screen.getByLabelText("Статус"), "unread");
    expect(await screen.findByText("По выбранным фильтрам ничего нет")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Сбросить фильтры" }));
    expect(await screen.findByRole("heading", { name: item.title })).toBeVisible();
  });
});
