import { expect, test } from "@playwright/test";
import { openSurveyApp } from "./fixtures/surveyApp";

for (const theme of ["sand", "graphite"]) {
  test(`${theme}: compact templates use a bookmark and fit three, two and one columns`, async ({ page }, testInfo) => {
    // Six viewport reloads, menu screenshots and a persisted bookmark round trip
    // share this budget; individual assertions retain their default timeout.
    test.setTimeout(60_000);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.addInitScript(id => localStorage.setItem("survey-app:theme", id), theme);
    const app = await openSurveyApp(page, { responseCount: 0, elements: [{ type: "text", name: "name", title: "Имя" }] });
    const formMenuSize = await page.locator(".dashboard-actions-menu-shell .form-menu-trigger").first().evaluate(el => {
      const r = el.getBoundingClientRect(); return [r.width, r.height];
    });
    const longTitle = "НоваяформаНоваяформаНоваяформаНоваяформаНоваяформаНоваяформа";
    const titles = ["Мониторинг образовательных организаций", "Анкета участника", "Обратная связь", longTitle, "Заявка на конкурс", "Оценка качества обучения"];
    const templates = titles.map((title, i) => ({ ...app.form, id: `40000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`, title, form_type: "template", is_public: i % 2 === 0 }));
    await page.route("**/list_forms_keyset*", route => route.fulfill({ json: templates }));
    await page.goto("/templates");
    const cards = page.locator(".templates-card");
    await expect(cards).toHaveCount(6);
    const pin = page.getByRole("button", { name: "Закрепить шаблон Анкета участника", exact: true });
    await expect(pin.locator('[data-icon="bookmark"]')).toHaveCSS("width", "24px");
    await pin.click();
    const pinned = page.getByRole("button", { name: "Открепить шаблон Анкета участника", exact: true });
    await expect(pinned).toHaveAttribute("aria-pressed", "true");
    await expect.poll(() => pinned.locator('[data-icon="bookmark"]').evaluate(el => getComputedStyle(el).fontVariationSettings)).toContain('"FILL" 1');
    await expect(cards.first().locator(".templates-card-title")).toHaveText("Анкета участника");
    await page.reload();
    await expect(pinned).toHaveAttribute("aria-pressed", "true");
    await pinned.click();
    await expect(cards.first().locator(".templates-card-title")).toHaveText(titles[0]);

    for (const [width, columns] of [[1920, 3], [1440, 3], [1280, 3], [1000, 2], [390, 1], [320, 1]]) {
      await page.setViewportSize({ width, height: width >= 1000 ? 1000 : 844 });
      await page.goto("/templates");
      await expect(cards).toHaveCount(6);
      await page.mouse.move(5, 5);
      await page.waitForFunction(() => document.getAnimations().filter(animation => animation.effect?.getComputedTiming().iterations !== Infinity).every(animation => animation.playState !== "running"));
      expect(await page.locator(".templates-gallery-grid").evaluate(el => getComputedStyle(el).gridTemplateColumns.split(" ").length)).toBe(columns);
      const row = await cards.evaluateAll(els => els.map(el => {
        const r = el.getBoundingClientRect(); return { top: r.top, width: r.width, height: r.height };
      }));
      expect(row.filter(card => Math.abs(card.top - row[0].top) < 1)).toHaveLength(columns);
      if (columns === 3) expect(row[0].width / row[0].height).toBeLessThan(2.5);
      const menuButton = cards.first().locator(".templates-actions-menu-shell .form-menu-trigger");
      const menuSize = await menuButton.evaluate(el => {
        const r = el.getBoundingClientRect(); return [r.width, r.height];
      });
      expect(menuSize).toEqual(width <= 760 ? [44, 44] : formMenuSize);
      const centers = await menuButton.evaluate(el => {
        const button = el.getBoundingClientRect(), icon = el.querySelector("[data-icon=more_horiz]")!.getBoundingClientRect();
        return Math.abs(button.x + button.width / 2 - icon.x - icon.width / 2) + Math.abs(button.y + button.height / 2 - icon.y - icon.height / 2);
      });
      expect(centers).toBeLessThan(1);
      const title = page.locator(".templates-card-title").filter({ hasText: longTitle });
      expect(await title.evaluate(el => el.clientHeight <= 2 * Number.parseFloat(getComputedStyle(el).lineHeight) + 1 && el.scrollWidth <= el.clientWidth + 1)).toBe(true);
      await menuButton.click();
      const menu = page.getByRole("menu", { name: `Меню действий шаблона ${titles[0]}` });
      await expect(menu).toBeVisible();
      await expect(menu.getByRole("menuitem")).toHaveCount(3);
      await expect.poll(() => menu.evaluate(el => {
        const r = el.getBoundingClientRect();
        return r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight;
      })).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`templates-menu-${theme}-${width}.png`) });
      await page.keyboard.press("Escape");
      await expect(menu).toHaveCount(0);
      await expect(page.getByRole("dialog")).toHaveCount(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
    }
    expect(app.pageErrors).toEqual([]);
  });
}
