import { expect, test, type Locator } from "@playwright/test";
import { openSurveyApp } from "./fixtures/surveyApp";

async function expectMatchingActions(container: Locator) {
  await expect(async () => {
    const share = await container.locator(".dashboard-share-button").boundingBox();
    const menu = await container.locator(".dashboard-actions-menu-shell .form-menu-trigger").boundingBox();
    expect(share).not.toBeNull();
    expect(menu).not.toBeNull();
    expect(share!.width).toBe(menu!.width);
    expect(share!.height).toBe(menu!.height);
    expect(Math.abs(share!.y - menu!.y)).toBeLessThan(1);
    expect(menu!.x - share!.x - share!.width).toBeCloseTo(6, 0);
  }).toPass({ timeout: 5000 });
}

for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }, { width: 320, height: 740 }]) {
  test(`form sharing works at ${viewport.width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    const { pageErrors } = await openSurveyApp(page);
    const allForms = page.getByRole("link", { name: "Все формы", exact: true });
    if (!await allForms.isVisible()) {
      await page.getByRole("button", { name: "Показать меню", exact: true }).click();
    }
    await allForms.click();
    const card = page.locator(".dashboard-form-card").first();
    const share = card.getByRole("button", { name: "Поделиться формой Карточка 1" });
    await expect(share).toBeVisible();
    await expectMatchingActions(card);
    const shareBox = await share.boundingBox();
    expect(shareBox?.width).toBeLessThanOrEqual(viewport.width < 480 ? 40 : 36);
    expect(await share.locator("img").evaluate(image => {
      const rect = image.getBoundingClientRect();
      return rect.width === 16 && rect.height === 16;
    })).toBe(true);
    await share.click();
    const dialog = page.getByRole("dialog", { name: "Поделиться формой Карточка 1" });
    await expect(dialog).toBeVisible();
    const heading = await dialog.getByRole("heading", { name: "Поделиться формой", exact: true }).boundingBox();
    const modal = await dialog.boundingBox();
    expect(Math.abs(heading!.x + heading!.width / 2 - modal!.x - modal!.width / 2)).toBeLessThan(1);
    await expect(dialog.getByRole("textbox", { name: "Ссылка на форму" })).toHaveValue(/\/form\/20000000-/);
    await dialog.getByRole("tab", { name: "QR-код" }).click();
    await expect(dialog.getByAltText("QR-код формы Карточка 1")).toBeVisible();
    const qrPanel = dialog.getByRole("tabpanel", { name: "QR-код", exact: true });
    await expect(qrPanel).not.toContainText("/form/");
    const qrBox = await qrPanel.locator(".dashboard-qr-preview").boundingBox();
    for (const name of ["PNG", "SVG"]) {
      const button = qrPanel.getByRole("button", { name, exact: true });
      const box = await button.boundingBox();
      expect(box!.y).toBeGreaterThan(qrBox!.y + qrBox!.height);
      expect(await button.evaluate(el => getComputedStyle(el).backgroundImage)).toContain("rgb(17, 17, 17)");
      await expect(button.locator("img")).toBeVisible();
      await button.hover();
      await expect(button).toHaveCSS("transform", "none");
      const hoveredBox = await button.boundingBox();
      expect(hoveredBox!.y).toBeCloseTo(box!.y, 0);
    }
    await page.screenshot({ path: testInfo.outputPath("share-qr-light.png") });
    await dialog.getByRole("tab", { name: "Код для сайта" }).click();
    const code = dialog.getByRole("textbox", { name: "Код для встраивания" });
    await expect(code).toHaveValue(/<iframe/);
    await expect(code).toHaveValue(/loading="lazy"/);
    await page.screenshot({ path: testInfo.outputPath("share-modal.png") });
    await dialog.getByRole("button", { name: "Закрыть окно поделиться" }).click();
    await expect(dialog).toHaveCount(0);
    await page.getByRole("button", { name: "Показать таблицу" }).click();
    const row = page.locator(".dashboard-form-table-row").first();
    await row.locator(".dashboard-share-button").scrollIntoViewIfNeeded();
    await expectMatchingActions(row);
    await page.screenshot({ path: testInfo.outputPath("table-actions.png") });
    await page.getByRole("button", { name: "Фильтры", exact: true }).click();
    await expect(page.getByRole("region", { name: "Фильтры форм" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath("filters.png") });
    await page.getByLabel("Дата с", { exact: true }).focus();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("button", { name: "Фильтры", exact: true })).toBeFocused();
    if (!await page.locator(".sidebar-account-trigger").isVisible()) {
      await page.getByRole("button", { name: "Показать меню", exact: true }).click();
    }
    await page.locator(".sidebar-account-trigger").click();
    await page.getByRole("menuitem", { name: "Тема", exact: true }).click();
    await page.getByRole("menuitemradio", { name: "Тёмная", exact: true }).click();
    if (viewport.width < 760) await page.getByRole("button", { name: "Скрыть меню", exact: true }).click();
    await row.locator(".dashboard-share-button").click();
    await dialog.getByRole("tab", { name: "QR-код" }).click();
    await expect(dialog.getByAltText("QR-код формы Карточка 1")).toBeVisible();
    await expect(dialog.getByRole("tab", { name: "QR-код" })).toHaveCSS("color", "rgb(23, 23, 23)");
    expect(await dialog.getByRole("tablist").evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    for (const name of ["PNG", "SVG"]) {
      const button = dialog.getByRole("button", { name, exact: true });
      expect(await button.evaluate(el => getComputedStyle(el).backgroundImage)).toContain("rgb(255, 255, 255)");
      await expect(button).toHaveCSS("color", "rgb(23, 23, 23)");
    }
    await page.screenshot({ path: testInfo.outputPath("share-qr-dark.png") });
    expect(pageErrors).toEqual([]);
  });
}
