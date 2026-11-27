import { onlineManager, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { refreshAuthDependentQueries } from "../../app/providers/authCache";
import { ToastProvider } from "../../app/providers/ToastProvider";
import * as api from "../../entities/notification/api";
import type { Notification } from "../../entities/notification/model";
import NotificationsPage from "./NotificationsPage";

vi.mock("../../entities/notification/api");
vi.mock("../../app/providers/AuthProvider", () => ({ useAuth: () => ({ user: { id: "viewer" } }) }));

function CurrentPath() { return <output>{useLocation().pathname}</output>; }
function openCenter() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return { client, ...render(<QueryClientProvider client={client}>
    <ToastProvider><MemoryRouter initialEntries={["/notifications"]}><NotificationsPage /><CurrentPath /></MemoryRouter></ToastProvider>
  </QueryClientProvider>) };
}

function personalNotification(id: string, title: string, read_at: string | null = null): Notification {
  return { id, title, message: "Событие формы", category: "form_status", created_at: "2026-11-22T08:00:00Z",
    read_at, form_id: null, response_id: null, rule_id: null, announcement: null };
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

  it.each(["automation_succeeded", "constructor"])("renders a notification with unrecognized category %s", async (category) => {
    vi.mocked(api.getNotifications).mockResolvedValue({ items: [{
      id: "legacy", title: "Результат отправки", message: "Письмо отправлено", category: category as Notification["category"],
      created_at: "2026-11-22T08:00:00Z", read_at: null, form_id: null, rule_id: null, response_id: null, announcement: null,
    }], next: undefined });
    openCenter();
    const card = await screen.findByRole("article", { name: "Результат отправки" });
    expect(within(card).getByText("Уведомление")).toBeVisible();
    expect(within(card).getByText("Письмо отправлено")).toBeVisible();
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
    expect(within(card).queryByRole("button", { name: "Скрыть у себя" })).toBeNull();
    await user.selectOptions(screen.getByLabelText("Категория"), "announcement");
    await user.click(screen.getByRole("button", { name: "Отметить все прочитанными" }));
    expect(await screen.findByText("Непрочитанных: 0")).toBeVisible();
    const readCard = screen.getByRole("article", { name: item.title });
    expect(readCard).toHaveAttribute("data-unread", "false");
    expect(within(readCard).queryByRole("button", { name: "Отметить прочитанным" })).toBeNull();
    expect(api.acknowledgeAnnouncement).not.toHaveBeenCalled();
    const disclosure = within(readCard).getByRole("button", { name: item.title });
    expect(disclosure).toHaveAttribute("aria-expanded", "false");
    expect(within(readCard).queryByText("Пятница")).toBeNull();
    disclosure.focus();
    await user.keyboard("{Enter}");
    expect(disclosure).toHaveAttribute("aria-expanded", "true");
    expect(within(readCard).getByText("Пятница")).toBeVisible();
    await user.click(within(readCard).getByRole("button", { name: "Ознакомился" }));
    expect(await screen.findByText("Ознакомление подтверждено")).toBeVisible();
    expect(within(screen.getByRole("article", { name: item.title })).getByRole("button", { name: "Скрыть у себя" })).toBeEnabled();
    await user.selectOptions(screen.getByLabelText("Статус"), "unread");
    expect(await screen.findByText("По выбранным фильтрам ничего нет")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Сбросить фильтры" }));
    expect(await screen.findByRole("heading", { name: item.title })).toBeVisible();
  });

  it("removes an unread card and updates the counter before refetch completes, then restores it using the deletion token", async () => {
    const user = userEvent.setup();
    const item = personalNotification("one", "Форма закрыта");
    const deletionTime = "2026-11-22T08:01:00.123456Z";
    let deleted = false;
    let holdRefetch = false;
    vi.mocked(api.getNotifications).mockImplementation(async () =>
      holdRefetch ? new Promise(() => {}) : { items: deleted ? [] : [item], next: undefined });
    vi.mocked(api.getUnreadCount).mockImplementation(async () => holdRefetch ? new Promise(() => {}) : deleted ? 0 : 1);
    vi.mocked(api.deleteNotification).mockImplementation(async () => {
      deleted = true;
      holdRefetch = true;
      return deletionTime;
    });
    vi.mocked(api.restoreNotification).mockImplementation(async (userId, id, token) => {
      if (userId !== "viewer" || id !== item.id || token !== deletionTime) return false;
      deleted = false;
      holdRefetch = false;
      return true;
    });

    openCenter();
    const card = await screen.findByRole("article", { name: item.title });
    expect(await screen.findByText("Непрочитанных: 1")).toBeVisible();
    const remove = within(card).getByRole("button", { name: "Удалить уведомление" });
    remove.focus();
    await user.keyboard("{Enter}");
    expect(await screen.findByText("Непрочитанных: 0")).toBeVisible();
    expect(screen.queryByRole("article", { name: item.title })).toBeNull();
    expect(screen.getByRole("button", { name: "Отменить удаление" })).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(await screen.findByRole("article", { name: item.title })).toHaveAttribute("data-unread", "true");
    expect(await screen.findByText("Непрочитанных: 1")).toBeVisible();
    expect(screen.getByRole("heading", { name: "Уведомления" })).toHaveFocus();
  });

  it("keeps removals out of a changed session and leaves an item visible when deleting fails", async () => {
    const user = userEvent.setup();
    const item = personalNotification("one", "Форма закрыта", "now");
    let deleted = false;
    vi.mocked(api.getNotifications).mockImplementation(async () => ({ items: deleted ? [] : [item], next: undefined }));
    vi.mocked(api.deleteNotification)
      .mockRejectedValueOnce(new Error("offline"))
      .mockImplementationOnce(async () => { deleted = true; return "2026-11-22T08:01:00Z"; });
    vi.mocked(api.restoreNotification).mockImplementation(async () => { deleted = false; return true; });
    const { client } = openCenter();
    const card = await screen.findByRole("article", { name: item.title });
    await user.click(within(card).getByRole("button", { name: "Удалить уведомление" }));
    expect(await screen.findByText("Не удалось удалить уведомление")).toBeVisible();
    expect(card).toBeVisible();
    await user.click(within(card).getByRole("button", { name: "Удалить уведомление" }));
    const undo = await screen.findByRole("button", { name: "Отменить удаление" });
    act(() => refreshAuthDependentQueries(client));
    await user.click(undo);
    expect(api.restoreNotification).not.toHaveBeenCalled();
    expect(deleted).toBe(true);
  });

  it("confirms category-wide bulk deletion even when read notifications are outside the current view", async () => {
    const user = userEvent.setup();
    const unread = personalNotification("one", "Форма закрыта");
    const read = personalNotification("two", "Форма опубликована", "now");
    const other = { ...personalNotification("three", "Изменён ответ", "now"), category: "response_updated" as const };
    let items = [unread, read, other];
    vi.mocked(api.getNotifications).mockImplementation(async (category, status) => ({
      items: items.filter(item => (!category || item.category === category) && (status !== "unread" || !item.read_at)),
      next: undefined,
    }));
    vi.mocked(api.getUnreadCount).mockResolvedValue(1);
    vi.mocked(api.deleteReadNotifications).mockImplementation(async (_userId, category) => {
      const previous = items.length;
      items = items.filter(item => !item.read_at || (category && item.category !== category));
      return previous - items.length;
    });

    openCenter();
    await screen.findByRole("article", { name: unread.title });
    await user.selectOptions(screen.getByLabelText("Категория"), "form_status");
    await user.selectOptions(screen.getByLabelText("Статус"), "unread");
    const bulk = screen.getByRole("button", { name: "Удалить прочитанные" });
    await waitFor(() => expect(bulk).toBeEnabled());
    await user.click(bulk);
    const dialog = screen.getByRole("dialog", { name: "Удалить прочитанные уведомления?" });
    expect(within(dialog).getByText(/Состояние форм/)).toBeVisible();
    const cancel = within(dialog).getByRole("button", { name: "Отмена" });
    expect(cancel).toHaveFocus();
    await user.click(cancel);
    expect(bulk).toHaveFocus();
    expect(api.deleteReadNotifications).not.toHaveBeenCalled();
    await user.click(bulk);
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Удалить прочитанные" }));
    expect(await screen.findByText("Удалено уведомлений: 1")).toBeVisible();
    expect(screen.getByText("Непрочитанных: 1")).toBeVisible();
    await user.selectOptions(screen.getByLabelText("Категория"), "");
    await user.selectOptions(screen.getByLabelText("Статус"), "all");
    expect(await screen.findByRole("article", { name: other.title })).toBeVisible();
    expect(screen.getByRole("article", { name: unread.title })).toBeVisible();
    expect(screen.queryByRole("article", { name: read.title })).toBeNull();
  });

  it("collapses same-day response events and loads the individual cards only when expanded", async () => {
    const user = userEvent.setup();
    const latest = {
      ...personalNotification("latest", "Ответ Ивана"),
      category: "response_received" as const, form_id: "form", response_id: "response-2", message: "Анкета",
    };
    const earlier = { ...latest, id: "earlier", title: "Ответ Ольги", response_id: "response-1", read_at: "now" };
    vi.mocked(api.getNotifications).mockResolvedValue({
      items: [
        { ...latest, response_group: { day: "2026-11-22", count: 2, unread_count: 1 } },
        personalNotification("event", "Срок приёма истёк"),
      ],
      next: undefined,
    });
    vi.mocked(api.getUnreadCount).mockResolvedValue(2);

    const { client } = openCenter();
    const group = await screen.findByRole("button", { name: /2 новых ответа · Анкета/ });
    expect(group).toHaveAttribute("aria-expanded", "false");
    expect(group).toHaveTextContent("Непрочитанных: 1");
    expect(screen.getByRole("article", { name: "Срок приёма истёк" })).toBeVisible();
    expect(screen.queryByRole("article", { name: latest.title })).toBeNull();
    expect(api.getNotificationGroupItems).not.toHaveBeenCalled();

    const cursor = { id: latest.id, created_at: latest.created_at };
    vi.mocked(api.getNotificationGroupItems)
      .mockResolvedValueOnce({ items: [latest], next: cursor })
      .mockResolvedValueOnce({ items: [earlier], next: undefined });
    await user.click(group);
    expect(group).toHaveAttribute("aria-expanded", "true");
    const first = await screen.findByRole("article", { name: latest.title });
    await user.click(within(first).getByRole("button", { name: latest.title }));
    expect(within(first).getByRole("link", { name: "Открыть ответ" })).toHaveAttribute("href", "/dashboard/forms/form/responses?response=response-2");
    await user.click(screen.getByRole("button", { name: "Ещё в группе" }));
    expect(await screen.findByRole("article", { name: earlier.title })).toBeVisible();
    expect(api.getNotificationGroupItems).toHaveBeenLastCalledWith(
      { category: "response_received", formId: "form", day: "2026-11-22" }, "all", cursor, expect.any(AbortSignal),
    );
    expect(screen.getByText("Непрочитанных: 2")).toBeVisible();
    const newest = { ...latest, id: "newest", title: "Ответ Анны", response_id: "response-3" };
    vi.mocked(api.getNotifications).mockResolvedValue({
      items: [{ ...newest, response_group: { day: "2026-11-22", count: 3, unread_count: 2 } }],
      next: undefined,
    });
    vi.mocked(api.getNotificationGroupItems).mockResolvedValue({ items: [newest, latest, earlier], next: undefined });
    await act(async () => {
      await client.refetchQueries({ queryKey: ["notifications", "viewer", "list", "", "all"], exact: true });
    });
    expect(await screen.findByRole("article", { name: newest.title })).toBeVisible();
    expect(group).toHaveAttribute("aria-expanded", "true");
    await user.click(group);
    expect(group).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("article", { name: latest.title })).toBeNull();
  });

  it("reconciles a group that became a singleton between pages", async () => {
    const user = userEvent.setup();
    const earlier = {
      ...personalNotification("earlier", "Ответ Ольги"),
      category: "response_received" as const, form_id: "form", response_id: "response-1", message: "Анкета",
      response_group: { day: "2026-11-22", count: 1, unread_count: 1 },
    };
    const latest = { ...earlier, id: "latest", created_at: "2026-11-22T09:00:00Z", title: "Ответ Ивана",
      response_group: { ...earlier.response_group, count: 2, unread_count: 2 } };
    vi.mocked(api.getNotifications)
      .mockResolvedValueOnce({ items: [latest], next: { id: latest.id, created_at: latest.created_at } })
      .mockResolvedValueOnce({ items: [earlier], next: undefined });
    openCenter();

    const group = await screen.findByRole("button", { name: /2 новых ответа · Анкета/ });
    await user.click(screen.getByRole("button", { name: "Показать ещё" }));
    expect(await screen.findByRole("article", { name: earlier.title })).toBeVisible();
    expect(group).not.toBeInTheDocument();
    expect(api.getNotificationGroupItems).not.toHaveBeenCalled();
  });

  it("reports a failed bulk request without queuing it until reconnection", async () => {
    const user = userEvent.setup();
    vi.mocked(api.getNotifications).mockResolvedValue({ items: [personalNotification("one", "Форма закрыта", "now")], next: undefined });
    vi.mocked(api.deleteReadNotifications).mockRejectedValue(new Error("offline"));

    openCenter();
    await screen.findByRole("article", { name: "Форма закрыта" });
    await user.click(screen.getByRole("button", { name: "Удалить прочитанные" }));
    const dialog = screen.getByRole("dialog", { name: "Удалить прочитанные уведомления?" });
    act(() => onlineManager.setOnline(false));
    try {
      await user.click(within(dialog).getByRole("button", { name: "Удалить прочитанные" }));
      expect(await screen.findByText("Не удалось удалить прочитанные уведомления")).toBeVisible();
      expect(api.deleteReadNotifications).toHaveBeenCalledExactlyOnceWith("viewer", null);
    } finally {
      act(() => onlineManager.setOnline(true));
    }
    expect(api.deleteReadNotifications).toHaveBeenCalledTimes(1);
  });

  it("hides an optional announcement using its own action and removes it from the unread count", async () => {
    const user = userEvent.setup();
    const item: Notification = { ...personalNotification("one", "Обслуживание"), category: "announcement",
      announcement: { require_acknowledgement: false, acknowledged_at: null, action_label: null, action_url: null, display_mode: "banner" } };
    let hidden = false;
    vi.mocked(api.getNotifications).mockImplementation(async () => ({ items: hidden ? [] : [item], next: undefined }));
    vi.mocked(api.getUnreadCount).mockImplementation(async () => hidden ? 0 : 1);
    vi.mocked(api.hideAnnouncement).mockImplementation(async (userId, id) => { hidden = userId === "viewer" && id === item.id; return hidden; });

    openCenter();
    const card = await screen.findByRole("article", { name: item.title });
    expect(within(card).queryByRole("button", { name: "Удалить уведомление" })).toBeNull();
    await user.click(within(card).getByRole("button", { name: item.title }));
    await user.click(within(card).getByRole("button", { name: "Скрыть у себя" }));
    expect(await screen.findByText("Непрочитанных: 0")).toBeVisible();
    expect(screen.queryByRole("article", { name: item.title })).toBeNull();
  });
});
