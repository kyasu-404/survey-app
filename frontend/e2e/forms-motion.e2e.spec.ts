import { test, expect } from "@playwright/test";
import { openSurveyApp } from "./fixtures/surveyApp";

for (const mode of ["native", "fallback"] as const) {
  test(`list view fades once and keeps the latest rapid toggle (${mode})`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 1800 });
    if (mode === "fallback") await page.addInitScript(() => {
      Object.defineProperty(document, "startViewTransition", { configurable: true, value: undefined });
    });
    const { pageErrors, listRequests } = await openSurveyApp(page);
    await expect(page.locator(".dashboard-form-card")).toHaveCount(20);
    const requestCount = listRequests.length;
    const width = await page.locator(".dashboard-main-card").evaluate(node => node.getBoundingClientRect().width);
    const toggle = page.locator(".dashboard-layout-toggle");
    const list = page.locator(".dashboard-layout-transition");
    const observations: Array<{ opacity: string; animations: number; groupAnimation?: string }> = [];
    await page.exposeFunction("recordListTransition", (value: typeof observations[number]) => observations.push(value));
    if (mode === "native") await page.evaluate(() => {
      const original = document.startViewTransition.bind(document);
      document.startViewTransition = (...args: Parameters<typeof original>) => {
        const transition = original(...args);
        void transition.ready.then(() => {
          const groupAnimation = getComputedStyle(document.documentElement, "::view-transition-group(forms-layout)").animationName;
          return transition.finished.then(() => new Promise<void>(resolve => requestAnimationFrame(() => {
            const node = document.querySelector(".dashboard-layout-transition")!;
            (window as unknown as { recordListTransition(value: unknown): void }).recordListTransition({
              opacity: getComputedStyle(node).opacity, animations: node.getAnimations().length, groupAnimation,
            });
            resolve();
          })));
        }).catch(() => {});
        return transition;
      };
    });
    await toggle.click();
    await expect(page.getByRole("table").locator("tbody tr")).toHaveCount(20);
    await expect(page.locator("html")).not.toHaveAttribute("data-forms-transition", "true");
    await expect.poll(() => list.evaluate(node => node.getAnimations().length)).toBe(0);
    await expect(list).toHaveCSS("opacity", "1");
    expect(await page.locator(".dashboard-main-card").evaluate(node => node.getBoundingClientRect().width)).toBe(width);
    if (mode === "native") {
      await expect.poll(() => observations.length).toBe(1);
      expect(observations[0]).toEqual({ opacity: "1", animations: 0, groupAnimation: "none" });
    }
    await toggle.click({ clickCount: 3, delay: 25 });
    await expect(page.locator(".dashboard-form-card")).toHaveCount(20);
    await expect(page.getByRole("table")).toHaveCount(0);
    await expect(page.locator("html")).not.toHaveAttribute("data-forms-transition", "true");
    await expect.poll(() => list.evaluate(node => node.getAnimations().length)).toBe(0);
    await expect(list).toHaveCSS("opacity", "1");
    expect(await page.evaluate(() => localStorage.getItem("survey-app:forms-layout"))).toBe("cards");
    expect(listRequests.length).toBe(requestCount);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await toggle.click();
    await expect(page.getByRole("table")).toBeVisible();
    await expect(list).toHaveCSS("opacity", "1");
    expect(await list.evaluate(node => node.getAnimations().length)).toBe(0);
    expect(pageErrors).toEqual([]);
  });
}
