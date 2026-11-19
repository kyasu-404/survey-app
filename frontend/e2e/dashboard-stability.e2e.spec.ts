import { test, expect, type Locator, type Page } from "@playwright/test";
import { openSurveyApp } from "./fixtures/surveyApp";

const geometry = (toolbar: Locator) => toolbar.evaluate(element =>
  [element, ...element.querySelectorAll("input, select, button")].flatMap(node => {
    const { x, y, width, height } = node.getBoundingClientRect();
    return [x + scrollX, y + scrollY, width, height];
  }));

async function navigateFromSidebar(page: Page, title: string) {
  const navigation = page.getByRole("navigation", { name: "Основная навигация" });
  if (!await navigation.isVisible()) {
    await page.getByRole("button", { name: "Показать меню", exact: true }).click();
  }
  await navigation.getByRole("link", { name: title, exact: true }).click();
  // Closing the mobile drawer can leave the pointer over a toolbar button.
  // Keep its hover transition out of the refresh geometry measurements.
  await page.mouse.move(0, 0);
}

for (const width of [1440, 1760, 390]) {
  test(`filters stay still during initial and background refresh at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    const app = await openSurveyApp(page);
    await expect(page.locator(".dashboard-form-card")).toHaveCount(20);
    let release!: () => void;
    let gate: Promise<void> | undefined;
    let requestsStarted = 0;
    const hold = () => { gate = new Promise<void>(resolve => { release = resolve; }); };
    await page.route("**/list_forms_keyset*", async route => { requestsStarted++; await gate; await route.fallback(); });
    const toolbar = page.locator(".dashboard-toolbar");
    const expectSame = async (before: number[]) => {
      const after = await geometry(toolbar);
      expect(after).toHaveLength(before.length);
      expect(Math.max(...after.map((value, i) => Math.abs(value - before[i])))).toBeLessThan(1);
    };
    // A reload clears the query cache, so the first measurement has no timestamp.
    hold();
    await page.goto("/dashboard/all");
    await expect(page.getByText("Загрузка форм", { exact: true })).toBeVisible();
    const initial = await geometry(toolbar);
    release(); gate = undefined;
    await expect(page.locator(".dashboard-form-card")).toHaveCount(20);
    await expectSame(initial);
    for (const title of ["Мои формы", "Все формы", "Мои формы"]) {
      await navigateFromSidebar(page, "Шаблоны");
      await expect(page.getByRole("heading", { name: "Шаблоны", exact: true })).toBeVisible();
      hold();
      const startedBefore = requestsStarted;
      await navigateFromSidebar(page, title);
      await expect(page.getByPlaceholder(/^Поиск по названию/)).toBeVisible();
      await expect.poll(() => requestsStarted).toBeGreaterThan(startedBefore);
      await expect.poll(() => toolbar.evaluate(node => node.getAnimations({ subtree: true }).length)).toBe(0);
      const before = await geometry(toolbar);
      release(); gate = undefined;
      await expect(page.locator(".dashboard-form-card")).toHaveCount(20);
      await expectSame(before);
    }
    await expect(toolbar.getByRole("button", { name: "Обновить", exact: true })).toHaveCount(0);
    expect(app.pageErrors).toEqual([]);
  });
}

test("sidebar slides a long list without resizing it on every animation frame", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const { pageErrors, listRequests } = await openSurveyApp(page);
  for (let count = 40; count <= 200; count += 20) {
    await page.getByRole("button", { name: "Показать ещё", exact: true }).click();
    await expect(page.getByText(`Карточка ${count}`, { exact: true })).toBeVisible();
  }
  await page.evaluate(() => scrollTo(0, 0));
  const content = page.locator(".dashboard-page");
  const requestCount = listRequests.length;
  for (const label of ["Свернуть меню", "Развернуть меню"]) {
    const samples = await page.evaluate(async label => {
      const content = document.querySelector<HTMLElement>(".dashboard-page")!;
      document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!.click();
      const values: Array<{ x: number; width: number }> = [];
      for (let i = 0; i < 24; i++) {
        await new Promise(requestAnimationFrame);
        const { x, width } = content.getBoundingClientRect(); values.push({ x, width });
      }
      return values;
    }, label);
    expect(Math.max(...samples.map(s => s.width)) - Math.min(...samples.map(s => s.width))).toBeLessThan(1);
    expect(Math.abs(samples[0].x - samples.at(-1)!.x)).toBeGreaterThan(30);
  }
  await page.evaluate(() => {
    for (const label of ["Свернуть меню", "Развернуть меню", "Свернуть меню"])
      document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!.click();
  });
  await expect(page.getByRole("button", { name: "Развернуть меню" })).toBeVisible();
  await expect.poll(() => content.evaluate(node => node.getAnimations().length)).toBe(0);
  expect(await page.locator(".sidebar-region").evaluate(node => (node as HTMLElement).inert)).toBe(false);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.getByRole("button", { name: "Развернуть меню" }).click();
  expect(await content.evaluate(node => node.getAnimations().length)).toBe(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(listRequests.length).toBe(requestCount);
  expect(pageErrors).toEqual([]);
});

for (const route of ["my", "all"] as const) {
  test(`returning from responses restores the loaded ${route} list and its scroll position`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await openSurveyApp(page, { responseCount: 1 });
    await navigateFromSidebar(page, route === "my" ? "Мои формы" : "Все формы");
    await expect(page).toHaveURL(new RegExp(`/dashboard/${route}$`));
    const search = page.getByPlaceholder(/^Поиск по названию/);
    const filtered = page.waitForResponse(response => {
      const url = new URL(response.url());
      return url.pathname.endsWith("/list_forms_keyset") && Boolean(url.searchParams.get("or")?.includes("Карточка"));
    });
    await search.fill("Карточка");
    await filtered;
    if (route === "all") await page.getByRole("button", { name: "Показать таблицу" }).click();
    const entries = page.locator(route === "all" ? ".dashboard-form-table-row" : ".dashboard-form-card");
    await expect(entries).toHaveCount(20);
    await page.getByRole("button", { name: "Показать ещё" }).click();
    await expect(entries).toHaveCount(40);
    const counter = entries.nth(32).locator(".dashboard-responses-link");
    await counter.scrollIntoViewIfNeeded();
    const scroll = await page.evaluate(() => scrollY);
    expect(scroll).toBeGreaterThan(0);
    await counter.click();
    const back = page.getByRole("link", { name: "← Назад к формам" });
    await expect(back).toBeVisible();
    if (route === "my") {
      await back.click();
    } else {
      await page.reload(); // The list must also recover from an empty query cache.
      await expect(back).toBeVisible();
      await page.goBack();
    }
    await expect(page).toHaveURL(new RegExp(`/dashboard/${route}$`));
    await expect(search).toHaveValue("Карточка");
    await expect(entries).toHaveCount(40);
    await expect.poll(() => page.evaluate(() => scrollY)).toBe(scroll);
  });
}
