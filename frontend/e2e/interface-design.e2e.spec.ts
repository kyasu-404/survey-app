import { expect, test, type Locator } from "@playwright/test";
import { openSurveyApp } from "./fixtures/surveyApp";

async function contrast(locator: Locator) {
  return locator.evaluate(element => {
    const pixel = document.createElement("canvas");
    pixel.width = pixel.height = 1;
    const pixelContext = pixel.getContext("2d")!;
    const rgb = (color: string) => {
      pixelContext.clearRect(0, 0, 1, 1);
      pixelContext.fillStyle = color;
      pixelContext.fillRect(0, 0, 1, 1);
      return Array.from(pixelContext.getImageData(0, 0, 1, 1).data).slice(0, 3);
    };
    const luminance = (color: number[]) => color.map(value => {
      const channel = value / 255;
      return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4;
    }).reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0);
    let surface: Element | null = element;
    while (surface && getComputedStyle(surface).backgroundColor === "rgba(0, 0, 0, 0)") surface = surface.parentElement;
    if (!surface) throw new Error("Text has no opaque background to measure");
    let foreground = rgb(getComputedStyle(element).color);
    if (element instanceof HTMLImageElement) {
      const canvas = document.createElement("canvas");
      canvas.width = element.naturalWidth; canvas.height = element.naturalHeight;
      const context = canvas.getContext("2d")!;
      context.filter = getComputedStyle(element).filter;
      context.drawImage(element, 0, 0);
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      let count = 0; foreground = [0, 0, 0];
      for (let i = 0; i < pixels.length; i += 4) {
        if (pixels[i + 3] < 240) continue;
        count++;
        for (let channel = 0; channel < 3; channel++) foreground[channel] += pixels[i + channel];
      }
      if (!count) throw new Error("Icon has no visible opaque pixels");
      foreground = foreground.map(value => value / count);
    }
    const values = [luminance(foreground), luminance(rgb(getComputedStyle(surface).backgroundColor))];
    return (Math.max(...values) + .05) / (Math.min(...values) + .05);
  });
}

test("dark status, actions, response cells and inspector fields remain readable", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.addInitScript(() => localStorage.setItem("survey-app:theme", "graphite"));
  const app = await openSurveyApp(page, { responseCount: 1, elements: [{ type: "text", name: "name", title: "Организация" }] });
  const create = page.getByRole("link", { name: "Создать форму", exact: true });
  await expect(create).toHaveAttribute("href", "/builder");
  expect(await contrast(create)).toBeGreaterThanOrEqual(4.5);
  expect(await contrast(page.locator(".dashboard-status-pill-active").first())).toBeGreaterThanOrEqual(4.5);
  expect(await page.locator(".dashboard-forms-grid").evaluate(el => getComputedStyle(el).gridTemplateColumns.split(" ").length)).toBe(2);

  await page.goto(`/dashboard/forms/${app.formId}/responses`);
  const cell = page.locator(".responses-page-table-shell tbody td").nth(1);
  await expect(cell).toHaveCSS("color", "rgb(227, 227, 227)");
  expect(await contrast(cell)).toBeGreaterThanOrEqual(4.5);
  await page.goto(`/builder/${app.formId}`);
  await page.getByRole("button", { name: "Редактировать безопасно", exact: true }).click();
  const field = page.getByRole("textbox", { name: "Название опроса", exact: true });
  await expect(field).toBeVisible();
  expect(await contrast(field)).toBeGreaterThanOrEqual(4.5);
  expect(app.pageErrors).toEqual([]);
});

test("mobile sharing fits its content and primary actions retain touch targets", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => localStorage.setItem("survey-app:theme", "graphite"));
  const app = await openSurveyApp(page);
  const share = page.locator(".dashboard-share-button").first();
  expect(await share.evaluate(el => Math.min(el.getBoundingClientRect().width, el.getBoundingClientRect().height))).toBeGreaterThanOrEqual(44);
  await share.click();
  const dialog = page.getByRole("dialog", { name: "Поделиться формой Карточка 1", exact: true });
  await expect(dialog).toBeVisible();
  expect(await dialog.evaluate(el => el.getBoundingClientRect().height)).toBeLessThan(650);
  expect(await contrast(dialog.getByRole("button", { name: "Копировать ссылку", exact: true }))).toBeGreaterThanOrEqual(4.5);
  await dialog.getByRole("tab", { name: "QR-код", exact: true }).click();
  await expect(dialog.getByRole("img", { name: "QR-код формы Карточка 1", exact: true })).toBeVisible();
  expect(await contrast(dialog.getByRole("button", { name: "PNG", exact: true }))).toBeGreaterThanOrEqual(4.5);
  await page.keyboard.press("Escape");
  await expect(share).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  expect(app.pageErrors).toEqual([]);
});


for (const theme of ["sand", "graphite"]) {
  test(`${theme}: blue actions, green success and red errors keep distinct meanings`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.addInitScript(id => localStorage.setItem("survey-app:theme", id), theme);
    const app = await openSurveyApp(page, { responseCount: 0 });
    const colors = theme === "sand"
      ? { accent: "rgb(11, 87, 208)", success: "rgb(22, 101, 52)", danger: "rgb(185, 28, 28)" }
      : { accent: "rgb(168, 199, 250)", success: "rgb(129, 201, 149)", danger: "rgb(242, 184, 181)" };
    const primary = page.getByRole("link", { name: "Создать форму", exact: true });
    await expect(primary).toHaveCSS("background-color", colors.accent);
    expect(await contrast(primary)).toBeGreaterThanOrEqual(4.5);
    const status = page.locator(".dashboard-status-pill-active").first();
    await expect(status).toHaveCSS("color", colors.success);
    expect(await contrast(status)).toBeGreaterThanOrEqual(4.5);
    await status.hover();
    await expect(status).toHaveCSS("color", colors.success);
    expect(await contrast(status)).toBeGreaterThanOrEqual(4.5);
    await page.locator(".dashboard-actions-menu-shell .form-menu-trigger").first().click();
    expect(await contrast(page.locator(".form-menu-item:not(.form-menu-item-danger)").first())).toBeGreaterThanOrEqual(4.5);
    const deleteItem = page.locator(".form-menu-item-danger").first();
    await expect(deleteItem).toHaveCSS("color", colors.danger);
    expect(await contrast(deleteItem)).toBeGreaterThanOrEqual(4.5);
    await deleteItem.hover();
    await expect(deleteItem).toHaveCSS("color", colors.danger);
    expect(await contrast(deleteItem)).toBeGreaterThanOrEqual(4.5);
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Показать таблицу", exact: true }).click();
    await expect(page.locator(".dashboard-status-pill-active").first()).toHaveCSS("color", colors.success);
    await page.getByRole("button", { name: "Действия формы Карточка 1", exact: true }).click();
    const tableMenu = page.locator(".dashboard-table-menu");
    expect(await contrast(tableMenu.locator(".form-menu-item").first())).toBeGreaterThanOrEqual(4.5);
    await expect(tableMenu.locator(".form-menu-item-danger")).toHaveCSS("color", colors.danger);
    expect(await contrast(tableMenu.locator(".form-menu-item-danger"))).toBeGreaterThanOrEqual(4.5);
    await page.keyboard.press("Escape");
    let fail = true;
    await page.route("**/functions/v1/user-admin", route => {
      if (route.request().postDataJSON().action === "create") {
        return fail
          ? route.fulfill({ status: 400, json: { error: "Email уже занят" } })
          : route.fulfill({ json: { success: true } });
      }
      return route.fulfill({ json: { users: [
        { id: "other-user", name: "Пользователь", email: "user@example.test", role: "user", is_disabled: false },
        { id: "disabled-user", name: "Отключённый", email: "disabled@example.test", role: "user", is_disabled: true },
      ] } });
    });
    await page.goto("/users");
    const active = page.locator(".user-status-active");
    await expect(active).toHaveCSS("color", colors.success);
    expect(await contrast(active)).toBeGreaterThanOrEqual(4.5);
    for (const control of [page.locator(".user-status-disabled"), page.locator(".users-danger-button").first()]) {
      await expect(control).toHaveCSS("color", colors.danger);
      expect(await contrast(control)).toBeGreaterThanOrEqual(4.5);
      await control.hover();
      await expect(control).toHaveCSS("color", colors.danger);
      expect(await contrast(control)).toBeGreaterThanOrEqual(4.5);
    }
    await page.getByRole("button", { name: "+ Добавить пользователя", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Добавить пользователя", exact: true });
    await dialog.getByLabel("Имя", { exact: true }).fill("Иван");
    await dialog.getByLabel("Email", { exact: true }).fill("new@example.test");
    await dialog.getByLabel("Пароль", { exact: true }).fill("test-password-only");
    await dialog.getByRole("button", { name: "Создать пользователя", exact: true }).click();
    const error = page.locator(".toast-error");
    await expect(error).toContainText("Email уже занят");
    await expect(error).toHaveCSS("color", colors.danger);
    expect(await contrast(error)).toBeGreaterThanOrEqual(4.5);
    await expect(page.locator(".toast-container")).toHaveJSProperty("popover", "manual");
    await expect.poll(() => page.locator(".toast-container").evaluate(el => el.matches(":popover-open"))).toBe(true);
    await page.waitForFunction(() => document.getAnimations().filter(animation => animation.effect?.getComputedTiming().iterations !== Infinity).every(animation => animation.playState !== "running"));
    await page.screenshot({ path: testInfo.outputPath(`error-${theme}.png`) });
    fail = false;
    await dialog.getByRole("button", { name: "Создать пользователя", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    const success = page.locator(".toast-success");
    await expect(success).toContainText("Пользователь создан");
    await expect(success).toHaveCSS("color", colors.success);
    expect(await contrast(success)).toBeGreaterThanOrEqual(4.5);
    await page.waitForFunction(() => document.getAnimations().filter(animation => animation.effect?.getComputedTiming().iterations !== Infinity).every(animation => animation.playState !== "running"));
    await page.screenshot({ path: testInfo.outputPath(`success-${theme}.png`) });
    expect(app.pageErrors).toEqual([]);
  });

  test(`${theme}: account text, neutral action icons and user creation stay usable`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 720 });
    await page.addInitScript(id => localStorage.setItem("survey-app:theme", id), theme);
    const app = await openSurveyApp(page, { responseCount: 1 });
    for (const button of await page.locator(".dashboard-info-button").all()) {
      expect(await button.evaluate(el => {
        const control = el.getBoundingClientRect(), icon = el.querySelector("[data-icon]")!.getBoundingClientRect();
        return Math.abs((control.left + control.right - icon.left - icon.right) / 2)
          + Math.abs((control.top + control.bottom - icon.top - icon.bottom) / 2);
      })).toBeLessThan(.5);
    }
    const counter = page.locator(".dashboard-responses-link-hitbox").first();
    expect(await counter.evaluate(el => {
      const separator = el.parentElement!.querySelector(".dashboard-meta-separator")!;
      return el.getBoundingClientRect().left - separator.getBoundingClientRect().right;
    })).toBeGreaterThanOrEqual(6);
    expect((await counter.boundingBox())!.height).toBeLessThanOrEqual(30);
    const more = page.locator(".dashboard-actions-menu-shell .form-menu-trigger").first();
    expect(await more.evaluate(el => {
      const button = el.getBoundingClientRect(), icon = el.querySelector('[data-icon="more_horiz"]')!.getBoundingClientRect();
      return Math.abs((button.left + button.right - icon.left - icon.right) / 2)
        + Math.abs((button.top + button.bottom - icon.top - icon.bottom) / 2);
    })).toBeLessThan(1);
    const status = page.locator(".dashboard-status-trigger").first();
    const normal = await status.evaluate(el => getComputedStyle(el).backgroundColor);
    await status.hover();
    await expect.poll(() => status.evaluate(el => getComputedStyle(el).backgroundColor)).not.toBe(normal);
    await status.click();
    await expect(page.getByRole("menu", { name: /^Статус формы/ })).toBeVisible();
    await page.keyboard.press("Escape");
    await page.route("**/functions/v1/user-admin", route => route.fulfill({ json: { users: [{
      id: "other-user", name: "Пользователь", email: "user@example.test", role: "user", is_disabled: false,
    }] } }));
    await page.route("**/rest/v1/education_organizations?*", route => route.fulfill({ json: [{
      id: "org-1", organization_type: "school", number: "123", alias: "Школа", email: "school@example.test", is_archived: false,
    }] }));
    await page.goto("/users");
    await expect(page.locator(".users-table tbody tr")).toHaveCount(1);
    const addUser = page.getByRole("button", { name: "+ Добавить пользователя", exact: true });
    await expect(page.getByPlaceholder("Имя", { exact: true })).toHaveCount(0);
    await addUser.click();
    const controls = page.getByRole("dialog", { name: "Добавить пользователя", exact: true });
    await expect(controls).toBeVisible();
    await expect.poll(() => controls.evaluate(el => el.getAnimations().filter(animation => animation.playState === "running").length)).toBe(0);
    const initialHeight = (await controls.boundingBox())!.height;
    for (const height of [720, 1080]) {
      await page.setViewportSize({ width: 1440, height });
      const panelBox = (await controls.boundingBox())!;
      expect(panelBox.height).toBeCloseTo(initialHeight, 0);
      expect(panelBox.y).toBeGreaterThanOrEqual(0);
      expect(panelBox.y + panelBox.height).toBeLessThanOrEqual(height);
      expect((await controls.getByPlaceholder("Имя", { exact: true }).boundingBox())!.height).toBeLessThanOrEqual(50);
    }
    await page.keyboard.press("Escape");
    await expect(controls).toHaveCount(0);
    await expect(addUser).toBeFocused();
    await page.locator(".sidebar-account-trigger").click();
    const menu = page.getByRole("menu", { name: "Меню пользователя" });
    expect(await contrast(menu.locator(".sidebar-theme-label"))).toBeGreaterThanOrEqual(4.5);
    expect(await contrast(menu.getByRole("menuitem", { name: "Выйти", exact: true }).getByText("Выйти", { exact: true }))).toBeGreaterThanOrEqual(4.5);
    await page.keyboard.press("Escape");
    await page.goto(`/dashboard/forms/${app.formId}/responses`);
    const htmlIcon = page.locator(".responses-html-button .toolbar-icon");
    await expect(htmlIcon).toBeVisible();
    expect(await contrast(htmlIcon)).toBeGreaterThanOrEqual(3);
    await page.locator(".responses-html-button").hover();
    expect(await contrast(htmlIcon)).toBeGreaterThanOrEqual(3);
    await page.goto("/organizations");
    await expect(page.locator(".organizations-table tbody tr")).toHaveCount(1);
    expect(await contrast(page.locator(".organizations-delete-all-button .toolbar-icon"))).toBeGreaterThanOrEqual(3);
    const organizationDelete = page.locator(".organization-delete-button");
    await expect(organizationDelete).toHaveCSS("color", theme === "sand" ? "rgb(185, 28, 28)" : "rgb(242, 184, 181)");
    expect(await contrast(organizationDelete)).toBeGreaterThanOrEqual(4.5);
    await page.route("**/api/office/**", route => route.fulfill({ json: { enabled: false } }));
    await page.route("**/functions/v1/mail-admin", route => route.fulfill({ json: {} }));
    await page.route("**/functions/v1/form-admin", route => route.request().postDataJSON().action === "get-cleanup-status"
      ? route.fulfill({ json: { lastRun: null, schedule: null } }) : route.fallback());
    await page.goto("/settings");
    await page.getByRole("tab", { name: "Очистка файлов", exact: true }).click();
    await expect(page.locator(".settings-page-card")).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    expect(app.pageErrors).toEqual([]);
  });
}
