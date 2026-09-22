import { expect, test, type Page } from "@playwright/test";
import { openSurveyApp } from "./fixtures/surveyApp";

test.use({ isMobile: true, hasTouch: true });

async function expectPageFits(page: Page) {
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
}

async function navigateFromMenu(page: Page, name: string) {
  await page.getByRole("button", { name: "Показать меню", exact: true }).click();
  await page.getByRole("navigation", { name: "Основная навигация" }).getByRole("link", { name, exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Главное меню" })).toHaveCount(0);
}

for (const width of [320, 390]) {
  test(`mobile navigation, filters and admin screens fit ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 844 });
    const app = await openSurveyApp(page, { responseCount: 2 });
    await page.route("**/functions/v1/user-admin", route => route.fulfill({ json: { users: [{
      id: "other-user", name: "Московская Екатерина Владимировна", email: "long.email.address@example.test",
      role: "user", is_disabled: false, created_at: "2026-09-07T14:47:15Z",
    }] } }));
    await page.route("**/rest/v1/education_organizations?*", route => route.fulfill({ json: [{
      id: "organization-1", organization_type: "kindergarten", number: "373", alias: "ДОУ", email: "kindergarten373@example.test", is_archived: false,
    }] }));
    await page.route("**/functions/v1/mail-admin", route => route.fulfill({ json: {} }));
    await page.route("**/functions/v1/form-admin", route => route.request().postDataJSON().action === "get-cleanup-status"
      ? route.fulfill({ json: { lastRun: null, schedule: null } }) : route.fallback());
    await page.route("**/api/office/**", route => route.fulfill({ json: { enabled: false } }));

    await expect(page.locator(".dashboard-form-card").first()).toBeVisible();
    await expect(page.getByRole("link", { name: "Все формы", exact: true })).toBeHidden();
    expect(await page.locator(".dashboard-form-card").first().evaluate(el => el.getBoundingClientRect().top)).toBeLessThan(260);
    await expectPageFits(page);
    await page.screenshot({ path: testInfo.outputPath("dashboard.png") });
    await page.getByRole("button", { name: "Фильтры", exact: true }).click();
    await page.getByLabel("Тип формы", { exact: true }).selectOption("anketa");
    await page.getByLabel("Дата с", { exact: true }).fill("2026-01-01");
    await expectPageFits(page);
    await page.getByRole("button", { name: "Фильтры (2)", exact: true }).click();
    await expect(page.getByLabel("Тип формы", { exact: true })).toBeHidden();

    const trigger = page.getByRole("button", { name: "Показать меню", exact: true });
    await trigger.click();
    const drawer = page.getByRole("dialog", { name: "Главное меню" });
    await expect(drawer).toBeVisible();
    await expect(page.getByRole("button", { name: "Скрыть меню", exact: true })).toBeFocused();
    expect(await page.locator("main").evaluate(el => el.inert)).toBe(true);
    await page.keyboard.press("Shift+Tab");
    await expect(page.locator(".sidebar-account-trigger")).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: "Скрыть меню", exact: true })).toBeFocused();
    await page.screenshot({ path: testInfo.outputPath("navigation.png") });
    await page.keyboard.press("Escape");
    await expect(trigger).toBeFocused();
    await trigger.click();
    await page.locator(".mobile-sidebar-backdrop").click({ position: { x: width - 12, y: 200 } });
    await expect(drawer).toHaveCount(0);

    await navigateFromMenu(page, "Справочник ОУ");
    await expect(page.locator(".organizations-table tbody tr")).toHaveCount(1);
    await expectPageFits(page);
    const orgScroll = page.locator(".organizations-table-shell");
    expect(await orgScroll.evaluate(el => el.scrollWidth > el.clientWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath("organizations.png") });
    await page.getByRole("button", { name: "Изменить", exact: true }).click();
    const edit = page.getByRole("dialog", { name: "Изменение организации" });
    await expect(edit).toBeVisible();
    expect(await edit.evaluate(el => { const r = el.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; })).toBe(true);
    await expectPageFits(page);
    await edit.getByRole("button", { name: "Отмена", exact: true }).click();

    await navigateFromMenu(page, "Пользователи");
    await expect(page.locator(".users-table tbody tr")).toHaveCount(1);
    await expectPageFits(page);
    expect(await page.locator(".users-table th").first().evaluate(el => el.getBoundingClientRect().height)).toBeLessThan(60);
    await page.screenshot({ path: testInfo.outputPath("users.png") });
    await page.getByRole("button", { name: "Сменить пароль", exact: true }).click();
    await expectPageFits(page);
    await page.getByRole("button", { name: "Отмена", exact: true }).click();

    await navigateFromMenu(page, "Настройки");
    await expect(page.getByRole("heading", { name: "Основной логотип", exact: true })).toBeVisible();
    await expectPageFits(page);
    await page.screenshot({ path: testInfo.outputPath("settings.png") });
    await page.getByRole("tab", { name: "ONLYOFFICE", exact: true }).click();
    await expect(page.getByLabel("JWT Secret", { exact: true })).toBeVisible();
    await expectPageFits(page);

    await navigateFromMenu(page, "Шаблоны");
    await expect(page.getByRole("tab", { name: "Публичные", exact: true })).toBeVisible();
    await expectPageFits(page);

    await page.goto(`/dashboard/forms/${app.formId}/responses`);
    await expect(page.locator(".responses-page-table-shell tbody tr")).toHaveCount(2);
    await expectPageFits(page);
    expect(await page.locator(".responses-page-table-shell").evaluate(el => el.scrollWidth > el.clientWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath("responses.png") });
    await trigger.click();
    await page.locator(".sidebar-account-trigger").click();
    await page.getByRole("menuitem", { name: "Тема", exact: true }).click();
    await page.getByRole("menuitemradio", { name: "Тёмная", exact: true }).click();
    await page.getByRole("button", { name: "Скрыть меню", exact: true }).click();
    await expectPageFits(page);
    await page.screenshot({ path: testInfo.outputPath("responses-dark.png") });
    expect(app.pageErrors).toEqual([]);
  });
}

test("mobile builder keeps panels bounded and custom tabs and save available", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { formId, form, pageErrors } = await openSurveyApp(page, { responseCount: 0, elements: [{ type: "text", name: "name", title: "Ваше имя" }] });
  await page.goto(`/builder/${formId}`);
  await expect(page.locator(".svc-creator--mobile")).toBeVisible();
  await expect(page.locator(".svc-side-bar--mobile")).toBeHidden();
  await expectPageFits(page);
  expect(await page.locator(".svc-creator").evaluate(el => { const r = el.getBoundingClientRect(); return r.height > 400 && r.top >= 0 && r.bottom <= innerHeight + 1; })).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("builder.png") });
  const tabs = page.getByLabel("Раздел конструктора", { exact: true });
  await tabs.selectOption("runtime-preview");
  await expect(page.getByTestId("builder-preview-tab").getByRole("textbox", { name: "Ваше имя", exact: true })).toBeVisible();
  await page.getByTestId("builder-preview-tab").getByRole("textbox", { name: "Ваше имя", exact: true }).fill("Проверка");
  await expectPageFits(page);
  await page.screenshot({ path: testInfo.outputPath("builder-preview.png") });
  await tabs.selectOption("theme");
  await expectPageFits(page);
  await tabs.selectOption("logic");
  await expectPageFits(page);
  await tabs.selectOption("designer");
  await page.getByText("Добавить вопрос", { exact: true }).first().tap();
  await expect(page.locator(".svc-question__content")).toHaveCount(2);
  await page.setViewportSize({ width: 844, height: 390 });
  await expect(page.getByRole("link", { name: "Мои формы", exact: true })).toBeVisible();
  await expectPageFits(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("button", { name: "Показать меню", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Действия", exact: true }).click();
  await page.getByRole("button", { name: "Галерея фонов", exact: true }).click();
  await expect(page.getByRole("dialog", { name: /Галерея фонов/ })).toBeVisible();
  await expectPageFits(page);
  await page.getByRole("dialog", { name: "Галерея фонов", exact: true }).getByRole("button", { name: "Закрыть", exact: true }).click();
  await page.getByRole("button", { name: "Действия", exact: true }).click();
  const saved = page.waitForRequest(request => request.url().endsWith("/functions/v1/form-admin") && request.postDataJSON().action === "update-schema");
  await page.getByRole("button", { name: "Сохранить форму", exact: true }).click();
  await saved;
  await expect.poll(() => form.schema.pages[0].elements.length).toBe(2);
  await expect(page).toHaveURL(/dashboard/);
  expect(pageErrors).toEqual([]);
});
