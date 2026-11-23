import { expect, test } from "@playwright/test";
import type { AnnouncementPrompt } from "../src/entities/announcement/promptApi";
import type { Notification } from "../src/entities/notification/model";
import type { AdminAnnouncement } from "../src/pages/AnnouncementsPage/api";
import { openSurveyApp } from "./fixtures/surveyApp";

test("an administrator previews and schedules a formatted announcement", async ({ page }, testInfo) => {
  const app = await openSurveyApp(page);
  const title = "График технических работ";
  const rows: AdminAnnouncement[] = [];
  let submitted: unknown;
  await page.route("**/rest/v1/rpc/list_admin_announcements", (route) =>
    route.fulfill({ json: rows.filter(row => row.status === route.request().postDataJSON().p_status) }));
  await page.route("**/rest/v1/rpc/save_announcement", (route) => {
    const draft = route.request().postDataJSON();
    submitted = draft;
    const timestamp = new Date().toISOString();
    const id = crypto.randomUUID();
    rows.push({ ...draft.p_fields, id, status: "scheduled", audience_count: 4, familiar_count: 0,
      publish_at: draft.p_publish_at, created_at: timestamp, updated_at: timestamp });
    return route.fulfill({ json: id });
  });

  await page.getByRole("link", { name: "Администрирование", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Параметры приложения", exact: true })).toBeVisible();
  await page.getByRole("tab", { name: "SMTP", exact: true }).click();
  await expect(page.getByRole("heading", { name: "SMTP-коннектор" })).toBeVisible();
  await page.getByRole("navigation", { name: "Администрирование" }).getByRole("link", { name: "Объявления" }).click();
  await expect(page.getByRole("heading", { name: "Объявления", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Создать объявление" }).click();
  const editor = page.getByRole("dialog", { name: "Новое объявление" });
  await page.setViewportSize({ width: 390, height: 840 });
  await editor.getByLabel("Заголовок", { exact: true }).fill(title);
  const message = editor.getByLabel("Текст объявления", { exact: true });
  await message.fill("- Привет");
  await message.selectText();
  await editor.getByRole("button", { name: "Курсив", exact: true }).click();
  await expect(message).toHaveValue("- *Привет*");
  await expect.poll(() => message.evaluate((input: HTMLTextAreaElement) =>
    input.value.slice(input.selectionStart, input.selectionEnd))).toBe("Привет");
  await editor.getByRole("button", { name: "Полужирный", exact: true }).click();
  await expect(message).toHaveValue("- ***Привет***");
  await message.fill("**Плановое обновление**\n\n- Перерыв в работе");
  await editor.getByText("Ссылка на дополнительную информацию", { exact: true }).click();
  await editor.getByLabel("Ссылка", { exact: true }).fill("/preferences");
  await editor.getByRole("combobox", { name: "Аудитория", exact: true }).selectOption("user");
  await editor.getByRole("combobox", { name: "Способ отображения", exact: true }).selectOption("banner");
  await editor.getByRole("checkbox", { name: "Запросить подтверждение ознакомления" }).check();
  await editor.getByRole("combobox", { name: "Состояние публикации", exact: true }).selectOption("schedule");
  const scheduledTime = "2040-05-08T10:15";
  const publishAt = await page.evaluate(time => new Date(time).toISOString(), scheduledTime);
  await editor.getByLabel("Дата публикации", { exact: true }).fill(scheduledTime);
  await editor.getByRole("tab", { name: "Предпросмотр" }).click();
  await expect(editor.locator("strong").filter({ hasText: "Плановое обновление" })).toHaveCount(2);
  await expect(editor.getByRole("listitem").filter({ hasText: "Перерыв в работе" })).toHaveCount(2);
  await expect(editor.getByRole("button", { name: "Запланировать", exact: true })).toBeInViewport();
  await expect.poll(() => editor.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("announcement-preview-mobile.png") });
  await editor.getByRole("button", { name: "Запланировать", exact: true }).click();
  await expect(editor).toHaveCount(0);
  await expect(page.getByRole("tab", { name: "Запланированные" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("button", { name: title, exact: true })).toBeVisible();
  expect(submitted).toMatchObject({
    p_id: null, p_publication: "schedule", p_publish_at: publishAt,
    p_fields: { title, message: "**Плановое обновление**\n\n- Перерыв в работе",
      display_mode: "banner", audience: "user", require_acknowledgement: true, action_url: "/preferences" },
  });
  expect(app.pageErrors).toEqual([]);
});

test("shows banner and entry modal once, then keeps them in the personal feed", async ({ page }) => {
  const app = await openSurveyApp(page, { profileRole: "user" });
  const notices: Array<Notification & { presented: string | null }> = (["modal", "banner"] as const).map((mode, index) => ({
    id: crypto.randomUUID(), category: "announcement", title: mode === "modal" ? "Важное изменение" : "Справка обновлена",
    message: "**Для пользователей**", form_id: null, response_id: null, rule_id: null,
    created_at: "2026-11-22T09:0" + index + ":00Z", read_at: null, presented: null,
    announcement: { action_label: null, action_url: null, require_acknowledgement: mode === "modal", acknowledged_at: null, display_mode: mode },
  }));
  let claimCount = 0;
  await page.route("**/rest/v1/rpc/list_announcement_prompts", (route) => {
    const { p_visible_ids: visibleIds } = route.request().postDataJSON();
    const result: AnnouncementPrompt[] = notices.filter(row => visibleIds.includes(row.id) || (!row.presented && !row.read_at))
      .map((row) => ({
        id: row.id, title: row.title, message: row.message, action_label: null, action_url: null,
        display_mode: row.announcement!.display_mode as "modal" | "banner",
        require_acknowledgement: row.announcement!.require_acknowledgement, acknowledged_at: row.announcement!.acknowledged_at,
        read_at: row.read_at, expires_at: null, presented_at: row.presented,
      }));
    return route.fulfill({ json: result });
  });
  await page.route("**/rest/v1/rpc/claim_announcement_prompt", (route) => {
    const { p_id, p_mode } = route.request().postDataJSON();
    const entry = notices.find(row => row.id === p_id && row.announcement?.display_mode === p_mode);
    if (!entry || entry.presented) return route.fulfill({ json: false });
    claimCount += 1;
    entry.presented = new Date().toISOString();
    return route.fulfill({ json: true });
  });
  await page.route("**/rest/v1/rpc/list_notification_feed", (route) => {
    const { p_category, p_read } = route.request().postDataJSON();
    return route.fulfill({ json: notices.filter(row => (!p_category || row.category === p_category)
      && (p_read === "all" || (p_read === "unread" ? !row.read_at : row.read_at))) });
  });
  await page.route("**/rest/v1/rpc/notification_unread_count", (route) =>
    route.fulfill({ json: notices.filter(row => !row.read_at).length }));
  await page.route("**/rest/v1/rpc/mark_notifications_read", (route) => {
    const { p_id } = route.request().postDataJSON();
    const selected = notices.filter(row => !p_id || row.id === p_id);
    for (const row of selected) row.read_at = new Date().toISOString();
    return route.fulfill({ json: selected.length });
  });
  await page.route("**/rest/v1/rpc/acknowledge_announcement", (route) => {
    const { p_id } = route.request().postDataJSON();
    const row = notices.find(item => item.id === p_id)!;
    row.announcement!.acknowledged_at = new Date().toISOString();
    row.read_at ??= row.announcement!.acknowledged_at;
    return route.fulfill({ json: null });
  });

  await page.reload();
  const modal = page.getByRole("dialog", { name: "Важное изменение" });
  await expect(modal).toBeVisible();
  await modal.getByRole("button", { name: "Закрыть объявление" }).click();
  const banner = page.getByRole("region", { name: "Справка обновлена" });
  await expect(banner).toBeVisible();
  await banner.getByRole("button", { name: "Закрыть объявление" }).click();
  await expect.poll(() => notices.filter(row => row.read_at).length).toBe(2);
  const refresh = page.waitForResponse(response => response.url().endsWith("/rpc/list_announcement_prompts"));
  await page.reload();
  await page.getByRole("link", { name: /^Уведомления/ }).click();
  await refresh;
  await expect(modal).toHaveCount(0);
  await expect(banner).toHaveCount(0);
  expect(claimCount).toBe(2);
  await page.getByLabel("Категория").selectOption("announcement");
  await page.getByLabel("Статус").selectOption("read");
  await expect(page.getByRole("heading", { name: "Важное изменение" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Справка обновлена" })).toBeVisible();
  await page.getByRole("button", { name: "Ознакомился" }).click();
  await expect(page.getByText("Ознакомление подтверждено")).toBeVisible();
  expect(app.pageErrors).toEqual([]);
});
