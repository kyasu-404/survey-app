import { expect, test } from "@playwright/test";
import type { AutomationRule, AutomationRun } from "../src/entities/automation/model";
import type { Notification } from "../src/entities/notification/model";
import { openSurveyApp } from "./fixtures/surveyApp";

test("keeps global and form-specific rules separate and builds an email with conditions", async ({ page }, testInfo) => {
  const app = await openSurveyApp(page, { responseCount: 1, profileRole: "user" });
  const globalTitle = "Письмо о новом ответе";
  const scopedTitle = "Письмо о выбранных темах";
  const rules = new Map<string, AutomationRule>();
  const submissions = new Map<string, unknown>();
  let scopedFormId = "";
  const formTitle = "Карточка 1";
  const history: AutomationRun[] = [{
    id: "run", form_id: app.formId, form_title: app.form.title, response_id: null, status: "failed",
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
  await page.route("**/rest/v1/automation_rules?*", (route) => {
    const params = new URL(route.request().url()).searchParams;
    const id = params.get("id")?.slice(3);
    if (id) return route.fulfill({ json: rules.get(id) ?? null });
    const matches = [...rules.values()].filter(rule =>
      (params.get("form_id") === "is.null" ? rule.form_id === null : "eq." + rule.form_id === params.get("form_id"))
      && (params.get("enabled") !== "eq.true" || rule.enabled));
    if (route.request().method() === "HEAD") return route.fulfill({
      status: 200, headers: { "access-control-expose-headers": "Content-Range", "content-range": "*/" + matches.length },
    });
    return route.fulfill({ json: matches });
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
    });
    return route.fulfill({ json: id });
  });
  await page.route("**/rest/v1/rpc/set_automation_rule_enabled", (route) => {
    const { p_id, p_enabled } = route.request().postDataJSON();
    const rule = rules.get(p_id);
    if (rule) rule.enabled = p_enabled;
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
  await expect(page.getByRole("heading", { name: formTitle })).toBeVisible();
  await expect(page.getByText(globalTitle, { exact: true })).toHaveCount(0);

  await page.getByRole("button", { name: "Создать правило" }).click();
  await editor.getByLabel("Название", { exact: true }).fill(scopedTitle);
  await next.click();
  await editor.getByText("Дополнительные условия", { exact: true }).click();
  await editor.getByRole("button", { name: "Добавить условие" }).click();
  await editor.getByText(/^Дополнительные условия/).click();
  await next.click();
  await expect(editor.getByRole("alert")).toContainText("Проверьте вопрос и значение каждого условия.");
  const question = editor.getByRole("combobox", { name: "Вопрос", exact: true });
  await expect(question).toBeVisible();
  await question.selectOption('["topics"]');
  await editor.getByLabel("Сравнение").selectOption("all_of");
  await editor.getByRole("checkbox", { name: "Первая" }).check();
  await editor.getByRole("checkbox", { name: "Вторая" }).check();
  await next.click();
  await editor.getByLabel(/^Получатель из ответа/).selectOption('["school"]');
  await next.click();
  await editor.getByRole("button", { name: "Сохранить правило" }).click();
  await expect(page.getByRole("heading", { name: scopedTitle })).toBeVisible();
  expect(submissions.get(scopedTitle)).toMatchObject({
    p_event_type: "response_received", p_form_id: scopedFormId,
    p_conditions: [{ path: ["topics"], op: "all_of", value: ["Первая", "Вторая"] }],
    p_action: { recipientPath: ["school"], mode: "summary" },
  });
  await expect(page.getByText("Сервер отклонил получателя", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Выключить", exact: true }).click();
  await expect(page.getByRole("button", { name: "Включить", exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Автоматизации формы", exact: true }).click();
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
  await page.getByRole("link", { name: "Открыть ответ" }).click();
  await expect(page).toHaveURL(new RegExp("[?]response=" + response.id));
  const preview = page.getByRole("dialog", { name: "Ответ на форму" });
  await expect(preview.getByRole("textbox", { name: "Имя" })).toHaveValue("Ответ 59");
  await preview.getByRole("button", { name: "Закрыть", exact: true }).click();

  await page.getByRole("link", { name: /^Уведомления/ }).click();
  await page.getByRole("button", { name: "Настроить", exact: true }).click();
  const settings = page.getByRole("dialog", { name: "Настройки уведомлений" });
  await expect(page).toHaveURL(/\/notifications$/);
  await settings.getByRole("checkbox", { name: "Новые ответы" }).uncheck();
  await settings.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(settings).toHaveCount(0);
  await expect.poll(() => muted).toEqual(["response_received"]);
  await page.getByRole("link", { name: "Настройки", exact: true }).click();
  await expect(page.getByRole("checkbox", { name: "Новые ответы" })).not.toBeChecked();
  expect(app.pageErrors).toEqual([]);
});
