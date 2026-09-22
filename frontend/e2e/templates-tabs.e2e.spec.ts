import { test, expect } from "@playwright/test";
import { openSurveyApp } from "./fixtures/surveyApp";

for (const width of [1440, 390]) {
  test(`template tabs keep their position on first load and when scrollbar appears at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    const app = await openSurveyApp(page);
    let release!: () => void;
    const firstLoad = new Promise<void>(resolve => { release = resolve; });
    await page.route("**/list_forms_keyset*", async route => {
      if (new URL(route.request().url()).searchParams.get("is_public") !== "eq.true") return route.fulfill({ json: [] });
      await firstLoad;
      return route.fulfill({ json: Array.from({ length: 20 }, (_, i) => ({ ...app.form, id: `template-${i}`, form_type: "template", title: `Шаблон ${i}` })) });
    });
    await page.goto("/templates");
    await expect(page.getByText("Шаблонов пока нет", { exact: true })).toBeVisible();
    const tabs = page.getByRole("tablist", { name: "Раздел шаблонов" });
    await tabs.evaluate(element => {
      const boxes = () => [element, ...element.children].flatMap(node => {
        const r = node.getBoundingClientRect(); return [r.x, r.y, r.width, r.height];
      });
      const before = boxes(); element.setAttribute("data-watch", "true"); element.setAttribute("data-shift", "0");
      const measure = () => {
        const shift = Math.max(...boxes().map((v, i) => Math.abs(v - before[i])));
        element.setAttribute("data-shift", String(Math.max(shift, Number(element.getAttribute("data-shift")))));
        if (element.hasAttribute("data-watch")) requestAnimationFrame(measure);
      }; requestAnimationFrame(measure);
    });
    await tabs.getByRole("tab", { name: "Публичные" }).click();
    await expect(page.locator(".templates-card-skeleton")).toHaveCount(4);
    release(); await expect(page.getByText("Шаблон 19", { exact: true })).toBeVisible();
    await tabs.getByRole("tab", { name: "Мои", exact: true }).click();
    await expect(page.getByText("Шаблонов пока нет", { exact: true })).toBeVisible();
    await tabs.getByRole("tab", { name: "Публичные" }).click();
    await expect(page.getByText("Шаблон 19", { exact: true })).toBeVisible();
    const shift = await tabs.evaluate(el => { el.removeAttribute("data-watch"); return Number(el.getAttribute("data-shift")); });
    expect(shift).toBeLessThan(1);
    await page.screenshot({ path: testInfo.outputPath("templates.png") });
    expect(app.pageErrors).toEqual([]);
  });
}
