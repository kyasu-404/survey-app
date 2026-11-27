import { expect, test, type Locator } from "@playwright/test";
import type { AutomationRule, AutomationRun } from "../src/entities/automation/model";
import type { Notification, NotificationFeedItem } from "../src/entities/notification/model";
import { openSurveyApp } from "./fixtures/surveyApp";

async function expectVisibleFocusOutline(field: Locator, scrollArea: string) {
  await field.focus();
  await expect(field).toBeFocused();
  await expect.poll(() => field.evaluate((input, selector) => {
    const scroll = input.closest(selector)!.getBoundingClientRect();
    const control = input.getBoundingClientRect();
    const style = getComputedStyle(input);
    const width = parseFloat(style.outlineWidth);
    const outer = Math.max(0, width + parseFloat(style.outlineOffset));
    return style.outlineStyle !== "none" && width > 0 &&
      control.left - outer >= scroll.left && control.right + outer <= scroll.right &&
      control.top - outer >= scroll.top && control.bottom + outer <= scroll.bottom;
  }, scrollArea)).toBe(true);
}

test("keeps the entire focus outline visible in automation and document dialogs", async ({ page }) => {
  const { formId } = await openSurveyApp(page, { responseCount: 1 });
  await page.route("**/rest/v1/automation_rules?*", route => route.fulfill({ json: [] }));
  await page.route("**/api/office/status", route => route.fulfill({ json: { enabled: true } }));
  await page.route("**/api/office/forms/*/documents", route =>
    route.fulfill({ json: { documents: [], enabled: true, max_file_mb: 25, response_count: 1 } }));

  await page.goto("/automations");
  await page.getByRole("button", { name: "Создать правило" }).click();
  const editor = page.getByRole("dialog", { name: "Новое правило" });
  await editor.getByRole("button", { name: "Настроить своё правило" }).click();
  await expectVisibleFocusOutline(editor.getByRole("textbox", { name: "Название", exact: true }), ".activity-editor-body");
  await editor.getByRole("button", { name: "Закрыть", exact: true }).click();

  await page.goto(`/dashboard/forms/${formId}/responses`);
  await page.getByRole("button", { name: "Документы", exact: true }).click();
  const documents = page.getByRole("dialog", { name: "Документы" });
  await expectVisibleFocusOutline(documents.getByRole("textbox", { name: "Поиск документов" }), ".office-tab-panel");
});

test("keeps global and form-specific rules separate and builds an email with conditions", async ({ page }, testInfo) => {
  const app = await openSurveyApp(page, { responseCount: 1, profileRole: "user" });
  const globalTitle = "Письмо о новом ответе";
  const scopedTitle = "Письмо о выбранных темах";
  const rules = new Map<string, AutomationRule>();
  const submissions = new Map<string, unknown>();
  let scopedFormId = "";
  const formTitle = "Карточка 1";
  const schoolId = crypto.randomUUID();
  const history: AutomationRun[] = [{
    id: "run", form_id: app.formId, form_title: app.form.title, response_id: app.responses[0].id,
    event_key: "received:" + app.responses[0].id, status: "failed",
    recipient_count: 1, sent_count: 0, failed_count: 1, cancelled_count: 0, last_error: "Сервер отклонил получателя",
    created_at: "2026-11-22T09:00:00Z",
  }];
  await page.route("**/rest/v1/forms?*", (route) => {
    const params = new URL(route.request().url()).searchParams;
    return params.has("author_id") ? route.fulfill({ json: { id: scopedFormId, title: formTitle } }) : route.fallback();
  });
  await page.route("**/rest/v1/rpc/automation_form_fields", (route) => route.fulfill({ json: [
    { path: ["school"], label: "Организация", type: "organization", choices: null, input_type: null },
    { path: ["topics"], label: "Темы", type: "checkbox", choices: ["Первая", "Вторая"], input_type: null },
  ] }));
  await page.route("**/rest/v1/rpc/list_form_organizations*", (route) => route.fulfill({ json: [
    { id: schoolId, organization_type: "school", alias: "Школа", number: "45" },
  ] }));
  await page.route("**/rest/v1/automation_rules?*", (route) => {
    const params = new URL(route.request().url()).searchParams;
    const id = params.get("id")?.slice(3);
    if (id) return route.fulfill({ json: rules.get(id) ?? null });
    const matches = [...rules.values()].filter(rule =>
      (params.get("form_id") === "is.null" ? rule.form_id === null : "eq." + rule.form_id === params.get("form_id"))
      && (params.get("archived_at") === "not.is.null" ? rule.archived_at !== null : rule.archived_at === null)
      && (params.get("enabled") !== "eq.true" || rule.enabled));
    if (route.request().method() === "HEAD") return route.fulfill({
      status: 200, headers: { "access-control-expose-headers": "Content-Range", "content-range": "*/" + matches.length },
    });
    return route.fulfill({ json: matches.map(rule => ({ ...rule, successful_runs: [{ count: 0 }] })) });
  });
  await page.route("**/rest/v1/automation_runs?*", (route) => route.fulfill({ json: history }));
  await page.route("**/rest/v1/rpc/save_automation_rule", (route) => {
    const draft = route.request().postDataJSON();
    submissions.set(draft.p_name, draft);
    const id = draft.p_id ?? crypto.randomUUID();
    rules.set(id, {
      id, form_id: draft.p_form_id, form: draft.p_form_id ? { title: formTitle } : null, name: draft.p_name,
      description: draft.p_description, enabled: draft.p_enabled, conditions: draft.p_conditions, event_type: draft.p_event_type,
      threshold: draft.p_threshold, interval_minutes: draft.p_interval_minutes, scheduled_at: draft.p_scheduled_at,
      match_mode: draft.p_match_mode, action_config: draft.p_action, created_at: "2026-11-22T08:00:00Z",
      archived_at: null,
    });
    return route.fulfill({ json: id });
  });
  await page.route("**/rest/v1/rpc/set_automation_rule_enabled", (route) => {
    const { p_id, p_enabled } = route.request().postDataJSON();
    const rule = rules.get(p_id);
    if (rule) rule.enabled = p_enabled;
    return route.fulfill({ json: null });
  });
  await page.route("**/rest/v1/rpc/archive_automation_rule", (route) => {
    const rule = rules.get(route.request().postDataJSON().p_id);
    if (rule) {
      rule.enabled = false;
      rule.archived_at = new Date().toISOString();
    }
    return route.fulfill({ json: null });
  });

  await expect(page.getByRole("link", { name: "Администрирование" })).toHaveCount(0);
  await page.goto("/settings/announcements");
  await expect(page).toHaveURL(/\/dashboard\/my$/);
  await page.getByRole("link", { name: "Автоматизации", exact: true }).click();
  await page.getByRole("button", { name: "Создать правило" }).click();
  const editor = page.getByRole("dialog", { name: "Новое правило", exact: true });
  await page.setViewportSize({ width: 390, height: 840 });
  await expect(editor).toBeVisible();
  await expect.poll(() => editor.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("automation-mobile.png") });
  await page.setViewportSize({ width: 1280, height: 800 });
  await editor.getByRole("button", { name: "Сообщать о новых ответах" }).click();
  await editor.getByLabel("Название", { exact: true }).fill(globalTitle);
  const next = editor.getByRole("button", { name: "Далее", exact: true });
  await next.click();
  await expect(editor.getByText("Дополнительные условия")).toHaveCount(0);
  await next.click();
  await editor.getByLabel("Адреса получателей").fill("team@example.invalid, other@example.invalid");
  await editor.getByLabel("Содержание").selectOption("full");
  await next.click();
  await expect(editor.getByRole("heading", { name: "Пример письма" })).toBeVisible();
  await editor.getByRole("button", { name: "Сохранить правило" }).click();
  await expect(page.getByRole("heading", { name: globalTitle })).toBeVisible();
  expect(submissions.get(globalTitle)).toMatchObject({
    p_event_type: "response_received", p_form_id: null, p_conditions: [],
    p_action: { mode: "full", recipients: ["team@example.invalid", "other@example.invalid"] },
  });

  await page.getByRole("link", { name: "Мои формы", exact: true }).click();
  await page.getByRole("button", { name: "Показать таблицу" }).click();
  await expect(page.getByRole("table")).toBeVisible();
  await expect(page.locator("html")).not.toHaveAttribute("data-forms-transition", "true");
  const actionButton = page.getByRole("button", { name: "Действия формы " + formTitle, exact: true });
  await actionButton.press("ArrowDown");
  const menu = page.getByRole("menu", { name: "Меню действий формы " + formTitle, exact: true });
  await expect(menu.getByRole("menuitem").nth(1)).toHaveAccessibleName("Редактировать");
  const scopedLink = menu.getByRole("menuitem").nth(2);
  await expect(scopedLink).toHaveAccessibleName(/^Автоматизации/);
  await expect(scopedLink.getByLabel("Активных правил: 0")).toBeVisible();
  const href = await scopedLink.getAttribute("href", { timeout: 5_000 });
  scopedFormId = href!.split("/")[3];
  await expect(menu.getByRole("menuitem").first()).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await expect(scopedLink).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(new RegExp("/dashboard/forms/" + scopedFormId + "/automations$"));
  await expect(page.getByRole("heading", { name: "Автоматизации формы" })).toBeVisible();
  await expect(page.getByText(`«${formTitle}»`, { exact: true })).toBeVisible();
  await expect(page.getByText(globalTitle, { exact: true })).toHaveCount(0);

  await page.getByRole("button", { name: "Создать правило" }).click();
  await editor.getByRole("button", { name: "Настроить своё правило" }).click();
  await editor.getByLabel("Название", { exact: true }).fill(scopedTitle);
  await next.click();
  await editor.getByText("Дополнительные условия", { exact: true }).click();
  await editor.getByRole("button", { name: "Добавить условие" }).click();
  await editor.getByText(/^Дополнительные условия/).click();
  await next.click();
  await expect(editor.getByRole("alert")).toContainText("Выберите вопрос для условия.");
  const question = editor.getByRole("combobox", { name: "Вопрос", exact: true });
  await expect(question).toBeVisible();
  await question.selectOption('["topics"]');
  await editor.getByLabel("Сравнение").selectOption("all_of");
  await editor.getByRole("checkbox", { name: "Первая" }).check();
  await editor.getByRole("checkbox", { name: "Вторая" }).check();
  await editor.getByRole("button", { name: "Добавить условие" }).click();
  await question.nth(1).selectOption('["school"]');
  await editor.getByRole("combobox", { name: "Значение", exact: true }).selectOption({ label: "Школа 45" });
  await next.click();
  await editor.getByLabel(/^Получатель из ответа/).selectOption('["school"]');
  await next.click();
  await editor.getByRole("button", { name: "Сохранить правило" }).click();
  await expect(page.getByRole("heading", { name: scopedTitle })).toBeVisible();
  expect(submissions.get(scopedTitle)).toMatchObject({
    p_event_type: "response_received", p_form_id: scopedFormId,
    p_conditions: [
      { path: ["topics"], op: "all_of", value: ["Первая", "Вторая"] },
      { path: ["school"], op: "eq", value: schoolId },
    ],
    p_action: { recipientPath: ["school"], mode: "summary" },
  });
  await expect(page.getByRole("heading", { name: `Новый ответ на форму «${app.form.title}»` })).toBeVisible();
  await expect(page.getByText("Сервер отклонил получателя", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Статус правила «" + scopedTitle + "»: Включено", exact: true }).click();
  await expect(page.getByRole("button", { name: "Статус правила «" + scopedTitle + "»: Выключено", exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Автоматизации формы", exact: true }).click();
  await expect(page.getByRole("link", { name: scopedTitle })).toBeVisible();
  await page.getByRole("link", { name: scopedTitle }).click();
  await page.getByRole("button", { name: "Архивировать", exact: true }).click();
  const archive = page.getByRole("dialog", { name: "Архивировать правило?" });
  await archive.getByRole("button", { name: "Архивировать", exact: true }).click();
  await expect(page.getByText("В архиве", { exact: true })).toBeVisible();
  await expect(page.getByText("Сервер отклонил получателя", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Автоматизации формы", exact: true }).click();
  await expect(page.getByRole("link", { name: scopedTitle })).toHaveCount(0);
  await page.getByRole("combobox", { name: "Статус", exact: true }).selectOption("archived");
  await expect(page.getByRole("link", { name: scopedTitle })).toBeVisible();
  await page.getByRole("link", { name: "Автоматизации", exact: true }).click();
  await expect(page.getByRole("link", { name: globalTitle })).toBeVisible();
  await expect(page.getByText(scopedTitle, { exact: true })).toHaveCount(0);
  expect(app.pageErrors).toEqual([]);
});

test("a direct response link opens the answer after signing in again", async ({ page }) => {
  const app = await openSurveyApp(page, { responseCount: 60, elements: [{ type: "text", name: "name", title: "Имя" }] });
  const response = app.responses[58];
  const link = "/dashboard/forms/" + app.formId + "/responses?response=" + response.id;

  await page.evaluate(() => localStorage.clear());
  await page.goto(link);
  await expect(page).toHaveURL(/\/login$/);
  await page.getByPlaceholder("Электронная почта").fill("test@example.test");
  await page.getByPlaceholder("Пароль").fill("test-only-password");
  await page.getByRole("button", { name: "Войти", exact: true }).click();

  await expect(page).toHaveURL(new RegExp("[?]response=" + response.id));
  const preview = page.getByRole("dialog", { name: "Ответ на форму" });
  await expect(preview.getByRole("textbox", { name: "Имя" })).toHaveValue("Ответ 59");
  expect(app.pageErrors).toEqual([]);
});

test("shows the full notification badge in expanded, collapsed and mobile navigation", async ({ page }, testInfo) => {
  await openSurveyApp(page, { responseCount: 0 });
  let unread = 1;
  await page.route("**/rest/v1/rpc/notification_unread_count", route => route.fulfill({ json: unread }));
  await page.goto("/notifications");

  const sidebar = page.getByRole("navigation", { name: "Основная навигация" });
  const checkBadge = async (navigation: Locator, count: number, text: string) => {
    const badge = navigation.getByRole("link", { name: `Уведомления, непрочитанных: ${count}` }).locator(".notification-counter");
    await expect(badge).toHaveText(text);
    await expect(badge).toBeVisible();
    await expect.poll(() => badge.evaluate(element => {
      const box = element.getBoundingClientRect();
      const range = document.createRange();
      range.selectNodeContents(element);
      const label = range.getBoundingClientRect();
      const link = element.closest("a")!.getBoundingClientRect();
      return label.left >= box.left && label.right <= box.right && label.top >= box.top && label.bottom <= box.bottom
        && box.left >= link.left && box.right <= link.right && box.top >= link.top && box.bottom <= link.bottom;
    })).toBe(true);
    return badge;
  };

  const singleDigit = await checkBadge(sidebar, 1, "1");
  await page.evaluate(async () => { await document.fonts.ready; });
  await singleDigit.screenshot({ path: testInfo.outputPath("notification-count-one.png"), scale: "css" });

  unread = 99;
  await page.reload();
  await checkBadge(sidebar, 99, "99");
  unread = 124;
  await page.reload();
  const expanded = await checkBadge(sidebar, 124, "99+");
  await expanded.screenshot({ path: testInfo.outputPath("notification-count-expanded.png"), scale: "css" });

  await page.getByRole("button", { name: "Свернуть меню", exact: true }).click();
  await expect(page.locator(".app-shell")).toHaveClass(/app-shell-sidebar-rail/);
  const collapsed = await checkBadge(sidebar, 124, "99+");
  await collapsed.screenshot({ path: testInfo.outputPath("notification-count-collapsed.png"), scale: "css" });

  await page.setViewportSize({ width: 390, height: 844 });
  const compact = await checkBadge(page.locator(".mobile-app-header"), 124, "99+");
  await compact.screenshot({ path: testInfo.outputPath("notification-count-mobile.png"), scale: "css" });
});

test("collapses response notices into a day group and keeps it open when the latest item is removed", async ({ page }, testInfo) => {
  const { formId } = await openSurveyApp(page, { responseCount: 0 });
  const day = "2026-11-27";
  let members: Notification[] = Array.from({ length: 27 }, (_, index) => ({
    id: `notice-${index + 1}`, category: "response_received", title: `Ответ ${index + 1}`, message: "Анкета",
    form_id: formId, response_id: `response-${index + 1}`, rule_id: null, announcement: null, read_at: null,
    created_at: new Date(Date.UTC(2026, 10, 27, 12, 59 - index)).toISOString(),
  }));
  const status: Notification = { ...members[0], id: "status", category: "form_status",
    title: "Форма закрыта", response_id: null, read_at: members[0].created_at };
  let groupReads = 0;
  await page.route("**/rest/v1/rpc/list_notification_feed", route => {
    const { p_timezone } = route.request().postDataJSON();
    expect(p_timezone).toEqual(expect.any(String));
    const grouped: NotificationFeedItem = {
      ...members[0], response_group: { day, count: members.length, unread_count: members.length },
    };
    return route.fulfill({ json: [grouped, status] });
  });
  await page.route("**/rest/v1/rpc/list_notification_group_items", route => {
    const { p_before_at, p_before_id, p_limit, ...scope } = route.request().postDataJSON();
    expect(scope).toEqual({
      p_category: "response_received", p_form_id: formId, p_day: day, p_read: "all", p_timezone: expect.any(String),
    });
    const start = p_before_id === null ? 0 : members.findIndex(item => item.id === p_before_id) + 1;
    if (start) expect(p_before_at).toBe(members[start - 1].created_at);
    groupReads++;
    return route.fulfill({ json: members.slice(start, start + p_limit) });
  });
  await page.route("**/rest/v1/rpc/notification_unread_count", route => route.fulfill({ json: members.length }));
  await page.route("**/rest/v1/rpc/delete_notification", route => {
    expect(route.request().postDataJSON()).toEqual({ p_id: "notice-1" });
    members = members.slice(1);
    return route.fulfill({ json: "2026-11-27T13:01:00.123456+00:00" });
  });

  await page.goto("/notifications");
  const group = page.getByRole("button", { name: /новых ответов · Анкета/ });
  await expect(group).toHaveText(/27 новых ответов · Анкета/);
  await expect(group).toHaveAttribute("aria-expanded", "false");
  const latest = page.getByRole("article", { name: "Ответ 1", exact: true });
  await expect(latest).toHaveCount(0);
  const statusRow = page.getByRole("article", { name: status.title });
  await expect(statusRow).toBeVisible();
  const expectCompact = async (row: typeof statusRow) => {
    await expect.poll(async () => (await row.boundingBox())?.height ?? Infinity).toBeLessThanOrEqual(52);
    await expect.poll(() => row.evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
  };
  await expectCompact(group);
  await expectCompact(statusRow);
  expect(groupReads).toBe(0);
  await page.screenshot({ path: testInfo.outputPath("response-notifications-grouped.png") });

  await group.focus();
  await page.keyboard.press("Enter");
  await expectCompact(latest);
  const disclosure = latest.getByRole("button", { name: "Ответ 1", exact: true });
  await expect(disclosure).toHaveAttribute("aria-expanded", "false");
  await disclosure.focus();
  await page.keyboard.press("Enter");
  const answer = latest.getByRole("link", { name: "Открыть ответ" });
  await expect(answer).toHaveAttribute("href", `/dashboard/forms/${formId}/responses?response=response-1`);
  await disclosure.click();
  await expect(answer).toHaveCount(0);
  await expectCompact(latest);
  await latest.getByRole("button", { name: "Удалить уведомление" }).click();
  await expect(group).toHaveText(/26 новых ответов · Анкета/);
  await expect(group).toHaveAttribute("aria-expanded", "true");
  await expect(latest).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Уведомления, непрочитанных: 26" })).toBeVisible();
  await page.getByRole("button", { name: "Ещё в группе" }).click();
  const lastRow = page.getByRole("article", { name: "Ответ 27", exact: true });
  await expect(lastRow).toBeVisible();

  await page.setViewportSize({ width: 320, height: 844 });
  await expectCompact(lastRow);
  await expectCompact(statusRow);
  await expectCompact(group);
  await group.click();
  await expect(group).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByRole("article", { name: "Ответ 27", exact: true })).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("response-notifications-grouped-mobile.png") });

  await page.evaluate(() => localStorage.setItem("survey-app:theme", "graphite"));
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "graphite");
  await expectCompact(group);
  await expectCompact(statusRow);
  await page.screenshot({ path: testInfo.outputPath("response-notifications-grouped-mobile-dark.png") });
});

test("deletes personal notifications with undo, clears scoped read items and hides an acknowledged announcement", async ({ page }) => {
  const { form } = await openSurveyApp(page, { responseCount: 0 });
  const createdAt = "2026-11-27T12:00:00Z";
  const deleteToken = "2026-11-27T12:30:21.123456+00:00";
  const unreadId = "5abe2313-04c6-4cf8-8fd2-e970e99a6441";
  const readId = "8e6e1cf1-c339-40bb-b329-74e2ca3e25c3";
  const otherId = "d08c3605-4130-451c-ade0-297a4d0ae39a";
  const announcementId = "0479488c-e881-42ca-8ed5-3222a42c60a1";
  const item = (id: string, title: string, fields: Partial<Notification> = {}): Notification => ({
    id, title, message: "Тестовое уведомление", category: "response_received", created_at: createdAt,
    form_id: null, response_id: null, rule_id: null, read_at: null, announcement: null, ...fields,
  });
  const notice = item(announcementId, "Важное объявление", {
    category: "announcement",
    announcement: {
      action_label: null, action_url: null, display_mode: "feed", require_acknowledgement: true, acknowledged_at: null,
    },
  });
  const peerNotice = item("78701d90-c3b7-4da1-b687-c0bc327dc6f0", "Служебное объявление", {
    category: "announcement", read_at: createdAt,
    announcement: {
      action_label: null, action_url: null, display_mode: "feed", require_acknowledgement: false, acknowledged_at: null,
    },
  });
  const notifications = [
    item(unreadId, "Новый ответ"),
    item(readId, "Прочитанный ответ", { read_at: createdAt }),
    item(otherId, "Форма закрыта", { category: "form_status", read_at: createdAt }),
    notice,
    peerNotice,
  ];
  const hidden = new Set<string>();
  const visible = () => notifications.filter(entry => !hidden.has(entry.id));
  await page.route("**/rest/v1/rpc/list_notification_feed", route => {
    const { p_category, p_read } = route.request().postDataJSON();
    return route.fulfill({ json: visible().filter(entry => (!p_category || entry.category === p_category)
      && (p_read === "all" || (p_read === "read" ? Boolean(entry.read_at) : !entry.read_at))) });
  });
  await page.route("**/rest/v1/rpc/notification_unread_count", route => route.fulfill({ json: visible().filter(entry => !entry.read_at).length }));
  await page.route("**/rest/v1/rpc/delete_notification", route => {
    expect(route.request().postDataJSON()).toEqual({ p_id: unreadId });
    hidden.add(unreadId);
    return route.fulfill({ json: deleteToken });
  });
  await page.route("**/rest/v1/rpc/restore_notification", route => {
    expect(route.request().postDataJSON()).toEqual({ p_id: unreadId, p_deleted_at: deleteToken });
    return route.fulfill({ json: hidden.delete(unreadId) });
  });
  await page.route("**/rest/v1/rpc/delete_read_notifications", route => {
    expect(route.request().postDataJSON()).toEqual({ p_category: "response_received" });
    hidden.add(readId);
    return route.fulfill({ json: 1 });
  });
  await page.route("**/rest/v1/rpc/acknowledge_announcement", route => {
    expect(route.request().postDataJSON()).toEqual({ p_id: announcementId });
    notice.read_at = createdAt;
    notice.announcement!.acknowledged_at = createdAt;
    return route.fulfill({ json: null });
  });
  await page.route("**/rest/v1/rpc/hide_announcement", route => {
    expect(route.request().postDataJSON()).toEqual({ p_id: announcementId });
    expect(notice.announcement!.acknowledged_at).toBe(createdAt);
    hidden.add(announcementId);
    return route.fulfill({ json: true });
  });

  await page.goto("/notifications");
  const unreadCard = page.getByRole("article", { name: "Новый ответ", exact: true });
  const announcement = page.getByRole("article", { name: "Важное объявление", exact: true });
  const unreadBadge = (count: number) => page.getByRole("link", { name: `Уведомления, непрочитанных: ${count}`, exact: true });
  await expect(unreadBadge(2)).toBeVisible();
  await unreadCard.getByRole("button", { name: "Удалить уведомление", exact: true }).click();
  await expect(unreadCard).toHaveCount(0);
  await expect(unreadBadge(1)).toBeVisible();
  await page.getByRole("button", { name: "Отменить удаление", exact: true }).click();
  await expect(unreadCard).toBeVisible();
  await expect(unreadBadge(2)).toBeVisible();

  await page.getByLabel("Категория").selectOption("response_received");
  await page.getByRole("button", { name: "Удалить прочитанные", exact: true }).click();
  const bulk = page.getByRole("dialog", { name: "Удалить прочитанные уведомления?" });
  await bulk.getByRole("button", { name: "Удалить прочитанные", exact: true }).click();
  await expect(bulk).toHaveCount(0);
  await expect(page.getByRole("article", { name: "Прочитанный ответ", exact: true })).toHaveCount(0);
  await expect(unreadCard).toBeVisible();
  await page.getByLabel("Категория").selectOption("");
  await expect(page.getByRole("article", { name: "Форма закрыта", exact: true })).toBeVisible();

  await announcement.getByRole("button", { name: notice.title, exact: true }).click();
  await expect(announcement.getByRole("button", { name: "Скрыть у себя", exact: true })).toHaveCount(0);
  await announcement.getByRole("button", { name: "Ознакомился", exact: true }).click();
  await announcement.getByRole("button", { name: "Скрыть у себя", exact: true }).click();
  await expect(announcement).toHaveCount(0);
  await expect(unreadBadge(1)).toBeVisible();

  const peerTab = await page.context().newPage();
  await peerTab.route("**/notification-peer-test", route => route.fulfill({ contentType: "text/html", body: "<!doctype html>" }));
  await peerTab.goto(new URL("/notification-peer-test", page.url()).href);
  const peerCard = page.getByRole("article", { name: peerNotice.title, exact: true });
  await expect(peerCard).toBeVisible();
  hidden.add(peerNotice.id);
  await peerTab.evaluate((userId) => {
    const channel = new BroadcastChannel(`survey:announcement-hidden:${userId}`);
    channel.postMessage("peer-tab");
    channel.close();
  }, form.author_id);
  await expect(peerCard).toHaveCount(0);
  await peerTab.close();
});

test("receives notifications live, marks them read, opens a specific answer and saves preferences", async ({ page }, testInfo) => {
  const app = await openSurveyApp(page, { responseCount: 60, elements: [{ type: "text", name: "name", title: "Имя" }] });
  const response = app.responses[58];
  const notifications: Notification[] = [];
  let muted: string[] | null = null;
  await page.route("**/rest/v1/rpc/list_notification_feed", (route) => {
    const { p_category, p_read } = route.request().postDataJSON();
    return route.fulfill({ json: notifications.filter(item =>
      (!p_category || p_category === item.category)
      && (p_read === "all" || (p_read === "unread" ? !item.read_at : item.read_at))) });
  });
  await page.route("**/rest/v1/rpc/notification_unread_count", (route) =>
    route.fulfill({ json: notifications.filter(item => !item.read_at).length }));
  await page.route("**/rest/v1/rpc/mark_notifications_read", (route) => {
    const { p_id } = route.request().postDataJSON();
    for (const notification of notifications) {
      if (!p_id || notification.id === p_id) notification.read_at = new Date().toISOString();
    }
    return route.fulfill({ json: 1 });
  });
  await page.route("**/rest/v1/notification_preferences?*", (route) => route.fulfill({ json: muted ? [{ muted_categories: muted }] : [] }));
  await page.route("**/rest/v1/rpc/save_notification_preferences", (route) => {
    muted = route.request().postDataJSON().p_muted_categories;
    return route.fulfill({ json: null });
  });

  await page.getByRole("link", { name: /^Уведомления/ }).click();
  await expect(page.getByRole("heading", { name: "Уведомлений пока нет" })).toBeVisible();
  await expect(page.getByText("Непрочитанных: 0")).toBeVisible();
  await expect.poll(() => app.realtime.connected("personal-notifications:")).toBe(true);
  const item: Notification = {
    id: "notice-1", category: "response_received", title: "Новый ответ", message: app.form.title,
    response_id: response.id, form_id: app.formId, rule_id: null, created_at: "2026-11-22T09:00:00Z", read_at: null, announcement: null,
  };
  notifications.push(item, { ...item, id: "notice-2", category: "form_status", title: "Срок приёма истёк", response_id: null });
  app.realtime.change("notifications", "INSERT", { ...item });
  await expect(page.getByRole("link", { name: "Уведомления, непрочитанных: 2" })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("notifications-desktop.png") });
  await page.getByLabel("Категория").selectOption("form_status");
  await expect(page.getByText("Новый ответ", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Отметить прочитанным", exact: true }).click();
  await expect(page.getByText("Непрочитанных: 1")).toBeVisible();
  await page.getByRole("button", { name: "Отметить все прочитанными" }).click();
  await expect(page.getByText("Непрочитанных: 0")).toBeVisible();

  await page.getByLabel("Категория").selectOption("response_received");
  await page.getByRole("button", { name: "Новый ответ", exact: true }).click();
  await page.getByRole("link", { name: "Открыть ответ" }).click();
  await expect(page).toHaveURL(new RegExp("[?]response=" + response.id));
  const preview = page.getByRole("dialog", { name: "Ответ на форму" });
  await expect(preview.getByRole("textbox", { name: "Имя" })).toHaveValue("Ответ 59");
  await preview.getByRole("button", { name: "Закрыть", exact: true }).click();

  await page.getByRole("link", { name: /^Уведомления/ }).click();
  await page.getByRole("button", { name: "Настроить", exact: true }).click();
  const settings = page.getByRole("dialog", { name: "Настройки уведомлений" });
  await expect(page).toHaveURL(/\/notifications$/);
  const newResponses = settings.getByRole("checkbox", { name: "Новые ответы" });
  await expect(newResponses).not.toBeChecked();
  await expect(settings.getByRole("checkbox", { name: "Изменения ответов" })).toBeChecked();
  await expect(settings.getByRole("checkbox", { name: "Ошибки автоматизации" })).toBeChecked();
  await newResponses.check();
  await settings.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(settings).toHaveCount(0);
  await expect.poll(() => muted).toEqual([]);

  await page.reload();
  await page.getByRole("button", { name: "Настроить", exact: true }).click();
  await expect(newResponses).toBeChecked();
  expect(app.pageErrors).toEqual([]);
});
