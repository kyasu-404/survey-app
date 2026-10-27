import { expect, test } from "@playwright/test";
import { openSurveyApp } from "./fixtures/surveyApp";

test("builder automatically uses a usable rail and restores the outside preference", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const app = await openSurveyApp(page, { responseCount: 0, elements: [{ type: "panel", name: "section", title: "Раздел", elements: [{ type: "text", name: "name", title: "Имя" }] }] });
  const sidebar = page.locator(".sidebar-region");
  await expect(sidebar).toHaveCSS("width", "236px");
  await page.goto(`/builder/${app.formId}`);
  await expect(page.locator(".svc-creator")).toBeVisible();
  await expect(sidebar).toHaveCSS("width", "72px");
  expect(await sidebar.evaluate(el => (el as HTMLElement).inert)).toBe(false);
  await expect(page.getByRole("link", { name: "Все формы", exact: true })).toBeVisible();
  await page.locator(".sidebar-account-trigger").click();
  expect(await page.getByRole("menu", { name: "Меню пользователя" }).evaluate(el => {
    const r = el.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight;
  })).toBe(true);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Развернуть меню", exact: true }).click();
  await expect(sidebar).toHaveCSS("width", "236px");
  await page.getByRole("button", { name: "Свернуть меню", exact: true }).click();
  await expect(sidebar).toHaveCSS("width", "72px");
  await expect(page.locator(".svc-toolbox")).toHaveCSS("border-radius", "16px");
  await expect(page.locator(".svc-side-bar__container-content")).toHaveCSS("border-radius", "18px");
  expect(await page.locator(".svc-side-bar__container-header").evaluate(el => {
    const header = el.getBoundingClientRect(), toolbar = document.querySelector(".svc-top-bar")!.getBoundingClientRect();
    return Math.abs(header.top - toolbar.top) + Math.abs(header.bottom - toolbar.bottom) + Math.abs(header.left - toolbar.right);
  })).toBeLessThan(1);
  const reset = page.getByRole("button", { name: /^Сбросить(?: конструктор)?$/ });
  expect((await reset.boundingBox())!.width).toBeLessThanOrEqual(44);
  await expect(reset.locator("svg")).toBeVisible();
  await reset.click();
  const resetDialog = page.locator(".builder-reset-modal");
  await expect(resetDialog.getByRole("heading", { name: "Сбросить конструктор?", exact: true })).toBeVisible();
  await resetDialog.getByRole("button", { name: "Отмена", exact: true }).click();
  await expect(resetDialog).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("builder-rail-islands.png") });
  await page.getByRole("link", { name: "Все формы", exact: true }).click();
  await expect(sidebar).toHaveCSS("width", "236px");
  await page.getByRole("button", { name: "Свернуть меню", exact: true }).click();
  await expect(sidebar).toHaveCSS("width", "72px");
  await page.getByRole("link", { name: "Конструктор", exact: true }).click();
  await page.getByRole("button", { name: "Развернуть меню", exact: true }).click();
  await page.getByRole("link", { name: "Все формы", exact: true }).click();
  await expect(sidebar).toHaveCSS("width", "72px");
  expect(app.pageErrors).toEqual([]);
});

test("user creation keeps a failed draft, prevents duplicate submission and closes on success", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const app = await openSurveyApp(page);
  let created = false;
  let fail = true;
  let finishCreate: (() => void) | undefined;
  const payloads: unknown[] = [];
  await page.route("**/functions/v1/user-admin", async route => {
    const body = route.request().postDataJSON();
    if (body.action === "create") {
      payloads.push(body);
      if (fail) return route.fulfill({ status: 400, json: { error: "Email уже занят" } });
      await new Promise<void>(resolve => { finishCreate = resolve; });
      created = true;
      return route.fulfill({ json: { success: true } });
    }
    return route.fulfill({ json: { users: created ? [{ id: "created-user", name: "Иван", email: "new@example.test", role: "user", is_disabled: false }] : [] } });
  });
  await page.goto("/users");
  const add = page.getByRole("button", { name: "+ Добавить пользователя", exact: true });
  await expect(page.getByPlaceholder("Имя", { exact: true })).toHaveCount(0);
  await add.click();
  const dialog = page.getByRole("dialog", { name: "Добавить пользователя", exact: true });
  await expect(dialog.getByLabel("Имя", { exact: true })).toBeFocused();
  await dialog.getByLabel("Имя", { exact: true }).fill("Иван");
  await dialog.getByLabel("Email", { exact: true }).fill("new@example.test");
  await dialog.getByLabel("Пароль", { exact: true }).fill("test-password-only");
  await dialog.getByRole("button", { name: "Создать пользователя", exact: true }).click();
  await expect(page.getByText("Email уже занят", { exact: true })).toBeVisible();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel("Имя", { exact: true })).toHaveValue("Иван");
  fail = false;
  await dialog.getByRole("button", { name: "Создать пользователя", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "Создать пользователя", exact: true })).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Отмена", exact: true })).toBeDisabled();
  finishCreate!();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator(".users-table")).toContainText("new@example.test");
  await expect(add).toBeFocused();
  expect(payloads).toHaveLength(2);
  await page.screenshot({ path: testInfo.outputPath("users-created.png") });
  expect(app.pageErrors).toEqual([]);
});

test("response side sheet covers navigation, traps focus and returns to the response row", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const app = await openSurveyApp(page, { responseCount: 1, elements: [{ type: "text", name: "name", title: "Имя" }] });
  await page.goto(`/dashboard/forms/${app.formId}/responses`);
  const trigger = page.getByRole("button", { name: /Открыть Ответ/ }).first();
  await trigger.click();
  const sheet = page.locator("dialog.response-preview-drawer");
  await expect(sheet.locator(".sd-root-modern")).toBeVisible();
  await expect.poll(() => sheet.evaluate(el => {
    const r = el.getBoundingClientRect(); return Math.abs(r.top) + Math.abs(r.right - innerWidth) + Math.abs(r.bottom - innerHeight);
  })).toBeLessThanOrEqual(1);
  expect(await page.evaluate(() => document.elementFromPoint(20, 50)?.tagName)).toBe("DIALOG");
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press("Tab");
    expect(await sheet.evaluate(el => el.contains(document.activeElement))).toBe(true);
  }
  await page.screenshot({ path: testInfo.outputPath("response-full-height.png") });
  await page.keyboard.press("Escape");
  await expect(sheet).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await page.getByRole("link", { name: "← Назад к формам", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard\/all$/);
  expect(app.pageErrors).toEqual([]);
});
