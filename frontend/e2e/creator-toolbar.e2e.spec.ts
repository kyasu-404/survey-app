import { expect, test, type Page } from "@playwright/test";
import { openSurveyApp } from "./fixtures/surveyApp";

async function expectReadableToolbar(page: Page, dark: boolean) {
  const icons = await page.locator(".svc-top-bar").evaluate(bar => {
    const rgb = (value: string) => {
      const values = value.match(/[\d.]+/g)!.map(Number);
      return [values[0], values[1], values[2], values[3] ?? 1];
    };
    const over = (front: number[], back: number[], alpha = front[3]) => front.slice(0, 3).map((value, i) => value * alpha + back[i] * (1 - alpha));
    const luminance = (color: number[]) => color.reduce((sum, value, i) => {
      const s = value / 255;
      return sum + (s <= .04045 ? s / 12.92 : ((s + .055) / 1.055) ** 2.4) * [.2126, .7152, .0722][i];
    }, 0);
    const barColor = rgb(getComputedStyle(bar).backgroundColor);
    return Array.from(bar.querySelectorAll<HTMLButtonElement>(".svc-toolbar__item")).filter(button => button.getClientRects().length).flatMap(button => {
      const style = getComputedStyle(button);
      const opacity = Number(style.opacity);
      const background = over(rgb(style.backgroundColor), barColor);
      const visibleBackground = over([...background, opacity], barColor);
      return Array.from(button.querySelectorAll("svg use")).map(icon => {
        const foreground = over(rgb(getComputedStyle(icon).fill), background);
        const visibleForeground = over([...foreground, opacity], barColor);
        const a = luminance(visibleForeground), b = luminance(visibleBackground);
        return { name: button.title || button.getAttribute("aria-label"), disabled: button.disabled, opacity,
          contrast: (Math.max(a, b) + .05) / (Math.min(a, b) + .05), fill: getComputedStyle(icon).fill };
      });
    });
  });
  expect(icons.length).toBeGreaterThanOrEqual(5);
  for (const icon of icons) {
    if (icon.disabled) {
      expect(icon.opacity).toBeLessThan(1);
      if (dark) expect(icon.contrast, `${icon.name}: disabled icon disappeared`).toBeGreaterThanOrEqual(3);
    } else {
      expect(icon.contrast, `${icon.name}: enabled icon has low contrast`).toBeGreaterThanOrEqual(4.5);
    }
  }
}

for (const theme of ["sand", "graphite"]) {
  test(`${theme}: toolbar icons stay readable as undo/redo and theme actions change state`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1680, height: 1000 });
    await page.addInitScript(id => localStorage.setItem("survey-app:theme", id), theme);
    const app = await openSurveyApp(page, { responseCount: 0, elements: [{ type: "text", name: "name", title: "Имя" }] });
    await page.goto(`/builder/${app.formId}`);
    const toolbar = page.locator(".svc-top-bar");
    const undo = toolbar.getByRole("button", { name: "Отменить", exact: true });
    const redo = toolbar.getByRole("button", { name: "Повтор", exact: true });
    await expect(undo).toBeDisabled();
    await expect(redo).toBeDisabled();
    await expectReadableToolbar(page, theme === "graphite");
    await page.screenshot({ path: testInfo.outputPath(`toolbar-disabled-${theme}.png`) });

    const grid = page.locator(".svc-side-bar__container");
    const general = grid.getByRole("button", { name: "Общие", exact: true });
    if (await general.getAttribute("aria-expanded") !== "true") await general.click();
    const title = grid.getByRole("textbox", { name: "Название опроса", exact: true });
    await title.fill("Проверка видимости действий");
    await title.press("Tab");
    await expect(undo).toBeEnabled();
    await expect(toolbar.getByRole("button", { name: "Сохранить опрос", exact: true })).toBeEnabled();
    await expectReadableToolbar(page, theme === "graphite");
    await undo.hover();
    await expectReadableToolbar(page, theme === "graphite");
    await page.screenshot({ path: testInfo.outputPath(`toolbar-undo-hover-${theme}.png`) });
    await undo.click();
    await expect(title).toHaveValue(app.form.title);
    await expect(redo).toBeEnabled();
    await expectReadableToolbar(page, theme === "graphite");
    await redo.click();
    await expect(title).toHaveValue("Проверка видимости действий");

    await page.getByRole("tab", { name: "Темы", exact: true }).click();
    for (const name of ["Настройки темы", "Сброс настроек темы по умолчанию", "Импорт", "Экспорт"]) {
      await expect(toolbar.getByRole("button", { name, exact: true })).toBeEnabled();
    }
    await expectReadableToolbar(page, theme === "graphite");
    const settings = toolbar.getByRole("button", { name: "Настройки темы", exact: true });
    if (theme === "graphite") await expect(settings).toHaveCSS("opacity", "1");
    await grid.getByText("Темный", { exact: true }).click();
    await expect(grid.getByRole("radio", { name: "Темный", exact: true })).toBeChecked();
    await expect(undo).toBeEnabled();
    await undo.click();
    await expect(grid.getByRole("radio", { name: "Свет", exact: true })).toBeChecked();
    await expect(redo).toBeEnabled();
    await expectReadableToolbar(page, theme === "graphite");
    await redo.click();
    await expect(grid.getByRole("radio", { name: "Темный", exact: true })).toBeChecked();
    await page.mouse.move(5, 5);
    await page.screenshot({ path: testInfo.outputPath(`toolbar-theme-${theme}.png`) });
    // The toolbar action opens settings; the native header owns closing them.
    await grid.getByRole("button", { name: "Скрыть панель", exact: true }).click();
    await expect(grid).toBeHidden();
    await settings.click();
    await expect(grid).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
    expect(app.pageErrors).toEqual([]);
  });
}
