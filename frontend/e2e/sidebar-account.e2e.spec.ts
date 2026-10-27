import { test, expect, type Locator } from "@playwright/test";
import { openSurveyApp } from "./fixtures/surveyApp";

async function expectMenuFits(menu: Locator) {
  await expect(menu).toBeVisible();
  await expect.poll(() => menu.evaluate(el => el.getAnimations().filter(animation => animation.playState === "running").length)).toBe(0);
  expect(await menu.evaluate(el => {
    const r = el.getBoundingClientRect();
    return r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth;
  })).toBe(true);
}

test("profile exposes two inline themes, preserves selection and supports keyboard and logout", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  const profileName = "Иванов Александр Сергеевич";
  const app = await openSurveyApp(page, { profileName });
  const trigger = page.locator(".sidebar-account-trigger");
  await expect(trigger).toHaveAccessibleName(profileName);
  await expect(trigger.locator(".sidebar-account-avatar")).toBeVisible();
  await expect(trigger).toHaveText("И");
  await trigger.click();
  const menu = page.getByRole("menu", { name: "Меню пользователя" });
  await expect(menu.locator(".sidebar-account-full-name")).toHaveText(profileName);
  await expect(menu.locator(".sidebar-account-header .sidebar-account-avatar")).toBeVisible();
  expect((await menu.locator(".sidebar-account-header").boundingBox())!.y).toBeLessThan((await menu.locator(".sidebar-theme-row").boundingBox())!.y);
  const light = menu.getByRole("menuitemradio", { name: "Светлая тема", exact: true });
  const dark = menu.getByRole("menuitemradio", { name: "Тёмная тема", exact: true });
  await expect(menu.getByRole("menuitemradio")).toHaveCount(2);
  await expect(menu.getByRole("menuitem")).toHaveCount(1);
  await expect(light).toHaveAttribute("aria-checked", "true");
  await expect(light).toBeFocused();
  await expectMenuFits(menu);
  const centers = await menu.locator(".sidebar-theme-label, .sidebar-theme-option").evaluateAll(elements => elements.map(el => {
    const r = el.getBoundingClientRect(); return r.top + r.height / 2;
  }));
  expect(Math.max(...centers) - Math.min(...centers)).toBeLessThan(1);
  await page.screenshot({ path: testInfo.outputPath("profile-light.png") });
  await page.keyboard.press("ArrowRight");
  await expect(dark).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "graphite");
  await expect(dark).toHaveAttribute("aria-checked", "true");
  await expect(light).toHaveAttribute("aria-checked", "false");
  await expect(menu).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("profile-dark.png") });
  const logoutIcon = menu.getByRole("menuitem", { name: "Выйти", exact: true }).locator('[data-icon="logout"]');
  await expect(logoutIcon).toBeVisible();
  await expect(logoutIcon).toHaveCSS("color", "rgb(227, 227, 227)");
  await page.keyboard.press("ArrowLeft");
  await expect(light).toBeFocused();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "graphite");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowDown");
  await expect(menu.getByRole("menuitem", { name: "Выйти", exact: true })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await page.getByRole("button", { name: "Свернуть меню", exact: true }).click();
  await expect(page.locator(".sidebar-region")).toHaveCSS("width", "72px");
  await expect(trigger.locator(".sidebar-account-avatar")).toBeVisible();
  await expect(trigger).toHaveText("И");
  await trigger.click();
  await expectMenuFits(menu);
  await expect(menu.locator(".sidebar-account-full-name")).toHaveText(profileName);
  await page.screenshot({ path: testInfo.outputPath("profile-rail.png") });
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Развернуть меню", exact: true }).click();
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "graphite");
  await trigger.click();
  await expect(dark).toHaveAttribute("aria-checked", "true");
  await light.click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "sand");
  await expect(menu).toBeVisible();
  await page.getByRole("link", { name: "Мои формы", exact: true }).click();
  await expect(menu).toHaveCount(0);
  await trigger.click();
  const logout = page.waitForRequest(request => request.url().includes("/auth/v1/logout"));
  await menu.getByRole("menuitem", { name: "Выйти", exact: true }).click();
  await logout;
  await expect(page).toHaveURL(/\/login$/);
  expect(app.pageErrors).toEqual([]);
});

for (const width of [320, 390]) {
  test(`inline profile toggle fits and keeps the mobile drawer open at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 844 });
    const profileName = "Александрова-Михайлова Мария Константиновна";
    const app = await openSurveyApp(page, { profileName });
    await page.getByRole("button", { name: "Показать меню", exact: true }).click();
    await page.locator(".sidebar-account-trigger").click();
    const menu = page.getByRole("menu", { name: "Меню пользователя" });
    await expectMenuFits(menu);
    await expect(menu.locator(".sidebar-account-full-name")).toHaveText(profileName);
    expect(await menu.locator(".sidebar-account-full-name").evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
    await expect(page.locator(".sidebar-account-trigger .sidebar-account-avatar")).toBeVisible();
    const choices = menu.getByRole("menuitemradio");
    await expect(choices).toHaveCount(2);
    for (const choice of await choices.all()) {
      const box = (await choice.boundingBox())!;
      expect(Math.min(box.width, box.height)).toBeGreaterThanOrEqual(44);
    }
    await menu.getByRole("menuitemradio", { name: "Тёмная тема", exact: true }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "graphite");
    await expect(menu).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath(`profile-mobile-${width}.png`) });
    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);
    await expect(page.getByRole("dialog", { name: "Главное меню", exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "Главное меню", exact: true })).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
    expect(app.pageErrors).toEqual([]);
  });
}
