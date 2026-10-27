import { expect, test, type Locator, type Page } from "@playwright/test";
import { openSurveyApp } from "./fixtures/surveyApp";

async function pageFits(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
}

async function popupUsable(popup: Locator) {
  await expect(popup).toBeVisible();
  await expect.poll(() => popup.evaluate(el => {
    const r = el.getBoundingClientRect();
    return r.left >= -1 && r.right <= innerWidth + 1 && r.top >= -1 && r.bottom <= innerHeight + 1
      && el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
  })).toBe(true);
}

async function expand(grid: Locator, name: string) {
  const section = grid.getByRole("button", { name, exact: true });
  if (await section.getAttribute("aria-expanded") !== "true") await section.click();
  await expect(section).toHaveAttribute("aria-expanded", "true");
}

for (const theme of ["sand", "graphite"]) {
  test(`${theme}: the card edge has a usable native resize target`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.addInitScript(id => localStorage.setItem("survey-app:theme", id), theme);
    const app = await openSurveyApp(page, { responseCount: 0 });
    await page.goto(`/builder/${app.formId}`);
    const grid = page.locator(".svc-side-bar__container");
    const card = grid.locator(".svc-side-bar__container-content");
    const handle = grid.locator(".svc-resizer-west");
    await expect(handle).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    await expect(handle).toHaveCSS("width", "16px");
    await expect(handle).toHaveCSS("cursor", "ew-resize");
    const initial = (await card.boundingBox())!;
    let box = (await handle.boundingBox())!;
    expect(box.x + box.width / 2).toBeCloseTo(initial.x, 0);
    const y = initial.y + initial.height / 2;
    for (const x of [box.x + 2, initial.x, box.x + box.width - 2]) {
      expect(await handle.evaluate((el, point) => document.elementFromPoint(point.x, point.y) === el, { x, y })).toBe(true);
    }
    // Drag from both outer and inner sides of the widened target. These points
    // miss the old 3px strip, so this exercises the actual usability regression.
    await page.mouse.move(box.x + 2, y);
    await page.mouse.down();
    await page.mouse.move(box.x + 2 - 100, y, { steps: 8 });
    await page.mouse.up();
    expect((await card.boundingBox())!.width).toBeCloseTo(initial.width + 100, 0);
    box = (await handle.boundingBox())!;
    await page.mouse.move(box.x + box.width - 2, y);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width - 2 + 80, y, { steps: 8 });
    await page.mouse.up();
    expect((await card.boundingBox())!.width).toBeCloseTo(initial.width + 20, 0);
    const edge = (await card.boundingBox())!;
    await page.mouse.move(edge.x, y);
    await page.screenshot({ path: testInfo.outputPath(`resize-hover-${theme}.png`) });
    const header = grid.locator(".svc-side-bar__container-header");
    expect(await header.evaluate(el => {
      const h = el.getBoundingClientRect(), t = document.querySelector(".svc-top-bar")!.getBoundingClientRect();
      return Math.abs(h.top - t.top) + Math.abs(h.bottom - t.bottom) + Math.abs(h.left - t.right);
    })).toBeLessThan(1);
    await header.getByRole("button", { name: "Скрыть панель", exact: true }).click();
    await expect(card).toBeHidden();
    await page.getByRole("button", { name: "Настройки опроса", exact: true }).click();
    await expect(card).toBeVisible();
    await pageFits(page);
    expect(app.pageErrors).toEqual([]);
  });

  test(`${theme}: continuous toolbar and floating Property Grid keep native settings usable`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.addInitScript(id => localStorage.setItem("survey-app:theme", id), theme);
    const app = await openSurveyApp(page, { responseCount: 0, elements: [{ type: "dropdown", name: "contact", title: "Способ связи", choices: ["Почта", "Телефон"] }] });
    await page.goto(`/builder/${app.formId}`);
    const grid = page.locator(".svc-side-bar__container");
    const card = grid.locator(".svc-side-bar__container-content");
    await expect(grid).toBeVisible();
    await expect(card).toHaveCSS("width", "360px");
    await expect(card).toHaveCSS("border-radius", "18px");
    await expect(card).toHaveCSS("border-left-width", "1px");
    await expect(card).not.toHaveCSS("box-shadow", "none");
    await expect(grid.locator(".svc-side-bar__container-header svg use").first()).toHaveCSS("fill", theme === "sand" ? "rgb(109, 101, 95)" : "rgb(196, 199, 197)");
    const layout = await grid.evaluate(el => {
      const card = el.querySelector(".svc-side-bar__container-content")!.getBoundingClientRect();
      const frame = el.closest(".svc-creator__side-bar--right")!.getBoundingClientRect();
      const workspace = document.querySelector(".svc-creator__content-wrapper")!.getBoundingClientRect();
      const header = el.querySelector(".svc-side-bar__container-header")!, toolbar = document.querySelector(".svc-top-bar")!;
      const h = header.getBoundingClientRect(), t = toolbar.getBoundingClientRect();
      return { gaps: [frame.right - card.right, frame.bottom - card.bottom, card.left - workspace.right],
        toolbarJoined: Math.abs(h.top - t.top) + Math.abs(h.bottom - t.bottom) + Math.abs(h.left - t.right) + Math.abs(h.right - frame.right),
        cardTopGap: card.top - h.bottom,
        toolboxAligned: Math.abs(card.top - document.querySelector(".svc-toolbox")!.getBoundingClientRect().top),
        colors: [toolbar, header].map(node => getComputedStyle(node).backgroundColor),
      };
    });
    for (const gap of layout.gaps) expect(gap).toBeGreaterThanOrEqual(10);
    expect(layout.toolbarJoined).toBeLessThan(1);
    expect(layout.cardTopGap).toBeGreaterThanOrEqual(6);
    expect(layout.cardTopGap).toBeLessThanOrEqual(10);
    expect(layout.toolboxAligned).toBeLessThan(1);
    expect(new Set(layout.colors).size).toBe(1);
    await expand(grid, "Общие");
    const search = grid.locator(".svc-search__input");
    await search.fill("Cookie");
    await expect(grid.locator('.spg-question--highlighted[data-name="cookieName"]')).toBeVisible();
    await expect(grid.getByText("Имя Cookie (отключить повторное прохождение опроса локально)", { exact: true })).toBeVisible();
    await search.fill("");
    await expect(grid.locator(".spg-question--highlighted")).toHaveCount(0);
    await expand(grid, "Общие");
    const title = grid.getByRole("textbox", { name: "Название опроса", exact: true });
    await title.fill("Проверка плавающей панели");
    await title.press("Tab");
    await expect(page.locator(".svc-designer-header")).toContainText("Проверка плавающей панели");
    const scroll = grid.locator(".spg-root-modern > .sv-scroll__wrapper > .sv-scroll__scroller");
    await expect(scroll).toHaveCSS("overflow-y", "auto");
    const headerTop = (await grid.locator(".svc-side-bar__container-header").boundingBox())!.y;
    await scroll.evaluate(el => { el.scrollTop = el.scrollHeight; });
    expect(await scroll.evaluate(el => el.scrollTop)).toBeGreaterThan(100);
    expect((await grid.locator(".svc-side-bar__container-header").boundingBox())!.y).toBeCloseTo(headerTop, 0);
    const locale = grid.locator('[data-name="locale"] .spg-dropdown');
    await locale.scrollIntoViewIfNeeded();
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await locale.click();
    const language = page.locator(".sv-popup__container:visible").filter({ hasText: "English" });
    await popupUsable(language);
    await language.getByText("English", { exact: true }).click();
    await expect(grid.locator('[data-name="locale"] .spg-dropdown')).toContainText("English");
    await grid.getByRole("button", { name: "Обзор", exact: true }).click();
    const overview = page.locator(".sv-popup__container:visible").last();
    await popupUsable(overview);
    await overview.getByText("Способ связи", { exact: true }).click();
    const questionTitle = grid.getByRole("textbox", { name: "Заголовок вопроса", exact: true });
    await questionTitle.fill("Контакт для обратной связи");
    await questionTitle.press("Tab");
    await expect(page.locator(".svc-question__content").first()).toContainText("Контакт для обратной связи");
    const description = "Введите понятный заголовок для отображения.";
    const help = grid.getByRole("button", { name: description, exact: true });
    await expect(help).toHaveAttribute("title", description);
    await help.click();
    await expect(grid.locator(".spg-description").filter({ hasText: description })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath(`question-help-${theme}.png`) });
    await expand(grid, "Логика");
    await grid.locator('[data-name="visibleIf"] button[title="Редактировать"]').click();
    const editor = page.locator(".sv-popup--modal-popup .sv-popup__container:visible");
    await popupUsable(editor);
    await page.screenshot({ path: testInfo.outputPath(`property-editor-${theme}.png`) });
    await editor.getByRole("button", { name: "Отменить", exact: true }).click();
    await expect(editor).toBeHidden();
    await pageFits(page);
    expect(app.pageErrors).toEqual([]);
  });

  test(`${theme}: resizing preserves the native flyout and mobile Property Grid`, async ({ page }, testInfo) => {
    // Several full Creator reloads plus both mobile widths form one scenario.
    // Keep individual assertions bounded while allowing a cold CI run to finish.
    test.setTimeout(60_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.addInitScript(id => localStorage.setItem("survey-app:theme", id), theme);
    const app = await openSurveyApp(page, { responseCount: 0 });
    await page.goto(`/builder/${app.formId}`);
    const grid = page.locator(".svc-side-bar__container");
    const card = grid.locator(".svc-side-bar__container-content");
    await expect(grid).toBeVisible();
    await page.setViewportSize({ width: 1000, height: 850 });
    await expect(page.locator(".svc-side-bar")).toHaveClass(/svc-side-bar--flyout/);
    await expect(grid).toBeVisible();
    const narrow = (await card.boundingBox())!;
    expect(narrow.width).toBe(360);
    expect(narrow.x + narrow.width).toBeLessThanOrEqual(1000 - 6);
    await pageFits(page);
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      await page.goto(`/builder/${app.formId}`);
      await expect(page.locator(".svc-creator--mobile")).toBeVisible();
      await page.getByRole("button", { name: "Настройки опроса", exact: true }).click();
      await expect(grid).toBeVisible();
      await expect.poll(() => card.evaluate(el => {
        const r = el.getBoundingClientRect();
        return r.x >= 6 && r.right <= innerWidth - 6 && r.bottom <= innerHeight - 4;
      })).toBe(true);
      const bounds = (await card.boundingBox())!;
      expect(bounds.x).toBeGreaterThanOrEqual(6);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(width - 6);
      expect(bounds.y + bounds.height).toBeLessThanOrEqual(844 - 4);
      await expect(card).toHaveCSS("border-radius", "16px");
      await expand(grid, "Общие");
      await expect(grid.getByRole("textbox", { name: "Название опроса", exact: true })).toBeVisible();
      await page.screenshot({ path: testInfo.outputPath(`mobile-${theme}-${width}.png`) });
      await grid.getByRole("button", { name: "Скрыть панель", exact: true }).click();
      await expect(grid).toBeHidden();
      await pageFits(page);
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/builder/${app.formId}`);
    await expect(card).toHaveCSS("width", "360px");
    await expect(card).toHaveCSS("border-radius", "18px");
    await pageFits(page);
    expect(app.pageErrors).toEqual([]);
  });
}
