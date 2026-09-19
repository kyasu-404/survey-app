import { test, expect } from "@playwright/test";
import { openSurveyApp } from "./fixtures/surveyApp";

test("table shares filters, follows server cursors and keeps menus usable in both themes", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1700, height: 950 });
  const app = await openSurveyApp(page);
  const requests: Array<Record<string, unknown>> = [];
  const rows = Array.from({ length: 67 }, (_, index) => ({
    ...app.form, id: `20000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    title: `Форма ${String(index + 1).padStart(2, "0")}`, responses_count: index + 1,
    max_responses: index === 0 ? 3 : null, deadline_at: index === 0 ? "2099-09-18T20:58:00Z" : null,
    sort_value: `форма ${String(index + 1).padStart(2, "0")}`, sort_reference_at: "2026-09-15T10:00:00.123456Z",
  }));
  await page.route("**/rest/v1/rpc/list_forms_sorted", async (route) => {
    const body = route.request().postDataJSON(); requests.push(body);
    const sorted = body.p_sort_direction === "asc" ? rows : [...rows].reverse();
    const start = body.p_after_id ? sorted.findIndex((row) => row.id === body.p_after_id) + 1 : 0;
    await route.fulfill({ json: sorted.slice(start, start + body.p_page_size + 1) });
  });
  await expect(page.locator(".dashboard-form-card")).toHaveCount(20);
  const initialRequests = app.listRequests.length;
  await page.getByRole("button", { name: "Показать таблицу" }).click();
  const table = page.getByRole("table");
  await expect(table.locator("tbody tr")).toHaveCount(20);
  expect(app.listRequests.length).toBe(initialRequests);
  for (const name of ["Тип формы", "Основание формы"]) await expect(page.getByLabel(name, { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Название", exact: true }).click();
  await expect(table.locator("tbody tr").first()).toContainText("Форма 01");
  await expect(table.locator("tbody tr").first().getByRole("button", { name: /Ответы формы/ })).toHaveText("1/3 ответов");
  const deadline = table.locator("tbody tr").first().getByRole("img", { name: /Открыта до/ });
  await deadline.hover();
  const tooltip = page.getByRole("tooltip");
  await expect(tooltip).toBeVisible();
  await expect(tooltip).toContainText(/Открыта до 18\.09\.2099/);
  await page.screenshot({ path: testInfo.outputPath("forms-table-deadline-tooltip.png") });
  await page.mouse.move(0, 0);
  await expect(tooltip).toHaveCount(0);
  await deadline.focus();
  await expect(tooltip).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(tooltip).toHaveCount(0);
  const statusWidth = await table.locator("tbody tr").first().locator("td").first().evaluate((cell) => cell.getBoundingClientRect().width);
  expect(statusWidth).toBeLessThan(120);
  await expect(table.locator("tbody tr").nth(1).locator(".dashboard-table-deadline")).toHaveCount(0);
  await expect(table.locator("thead th").last()).toHaveText("");
  expect(requests[0]).toMatchObject({ p_sort_field: "title", p_sort_direction: "asc", p_after_id: null });
  await page.getByRole("button", { name: "Показать ещё" }).click();
  await expect(table.locator("tbody tr")).toHaveCount(40);
  expect(requests[1]).toMatchObject({ p_after_id: rows[19].id, p_after_value: rows[19].sort_value, p_reference_time: rows[19].sort_reference_at });
  await page.getByRole("button", { name: "Название", exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath("forms-table-light.png"), fullPage: false });
  await page.getByRole("button", { name: "Название", exact: true }).click();
  await expect(table.locator("tbody tr").first()).toContainText("Форма 67");
  await expect(table.locator("tbody tr")).toHaveCount(20);
  await page.getByLabel("Тип формы", { exact: true }).selectOption("anketa");
  await page.getByLabel("Основание формы", { exact: true }).selectOption("plan");
  await page.getByPlaceholder(/^Поиск по названию/).fill("Форма");
  await expect.poll(() => requests.at(-1)?.p_search).toBe("Форма");
  expect(requests.at(-1)).toMatchObject({ p_form_type: "anketa", p_form_reason: "plan", p_after_id: null });
  await page.getByRole("button", { name: "Показать карточки" }).click();
  await expect(page.locator(".dashboard-form-card")).toHaveCount(20);
  await expect(page.getByPlaceholder(/^Поиск по названию/)).toHaveValue("Форма");
  await page.getByRole("button", { name: "Показать таблицу" }).click();
  await page.locator(".sidebar-account-trigger").click();
  await page.getByRole("menuitem", { name: "Тема", exact: true }).click();
  await page.getByRole("menuitemradio", { name: "Тёмная", exact: true }).click();
  await expect(page.locator(".dashboard-view-icon-dark")).toBeVisible();
  await expect.poll(() => page.locator(".dashboard-layout-toggle").evaluate((element) => getComputedStyle(element).backgroundColor)).toBe("rgb(58, 58, 58)");
  await page.screenshot({ path: testInfo.outputPath("forms-table-dark.png") });
  await page.setViewportSize({ width: 750, height: 650 });
  await table.locator("tbody tr").last().getByRole("button", { name: /Действия формы/ }).click();
  const menu = page.getByRole("menu", { name: /Меню действий формы/ });
  await expect(menu).toBeVisible();
  expect(await menu.evaluate((element) => {
    const r = element.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth;
  })).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("forms-table-narrow-menu.png") });
  await page.keyboard.press("Escape"); await expect(menu).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("table")).toBeVisible();
  await page.getByRole("link", { name: "Все формы", exact: true }).click();
  await expect(page.getByRole("table")).toBeVisible();
  await expect(page.getByPlaceholder("Поиск по названию и автору")).toBeVisible();
  expect(app.pageErrors).toEqual([]);
});
