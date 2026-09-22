import { test, expect } from "@playwright/test";
import { openSurveyApp } from "./fixtures/surveyApp";
import { mockRealtime } from "./fixtures/realtime";

test("new answers highlight once; reconnect and HTTP fallback preserve automatic updates", async ({ page }, testInfo) => {
  const app = await openSurveyApp(page, { responseCount: 1, elements: [{ type: "text", name: "name", title: "Имя" }] });
  const realtime = await mockRealtime(page);
  const row = (n: number) => ({ id: `30000000-0000-4000-8000-${String(n).padStart(12, "0")}`, form_id: app.formId, created_at: `2026-09-22T10:00:${String(n).padStart(2, "0")}Z`, data: { name: `Новый ответ ${n}` } });
  const rows = [row(1)];
  let reads = 0;
  await page.route("**/api/office/status", route => route.fulfill({ json: { enabled: false } }));
  await page.route("**/rest/v1/responses?*", route => {
    reads++;
    return route.fulfill({ json: rows, headers: { "access-control-expose-headers": "Content-Range", "content-range": `0-${rows.length - 1}/${rows.length}` } });
  });
  await page.goto(`/dashboard/forms/${app.formId}/responses`);
  await expect.poll(() => realtime.connected("form-responses:")).toBe(true);
  await expect.poll(() => reads).toBeGreaterThanOrEqual(2);
  await expect(page.getByRole("cell", { name: "Новый ответ 1", exact: true })).toBeVisible();
  await expect(page.locator(".response-row-new")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Обновить", exact: true })).toHaveCount(0);
  rows.unshift(row(2)); realtime.change("responses", "INSERT", rows[0]);
  const inserted = page.locator("tr.response-row-new");
  await expect(inserted).toContainText("Новый ответ 2");
  await expect(inserted.locator("td").first()).toHaveCSS("animation-name", "response-arrival");
  await page.screenshot({ path: testInfo.outputPath("new-answer.png") });
  await expect(page.locator(".response-row-new")).toHaveCount(0);
  const beforeUpdate = reads;
  rows[0].data.name = "Изменённый ответ"; realtime.change("responses", "UPDATE", rows[0]);
  await expect(page.getByRole("cell", { name: "Изменённый ответ", exact: true })).toBeVisible();
  expect(reads).toBeGreaterThan(beforeUpdate); await expect(page.locator(".response-row-new")).toHaveCount(0);
  // No realtime events are sent after the simulated channel error.
  realtime.disconnect(); rows.unshift(row(3));
  await expect(page.getByText(/Связь для автообновления прервалась/)).toBeVisible({ timeout: 9000 });
  await expect(page.getByRole("cell", { name: "Новый ответ 3", exact: true })).toBeVisible();
  realtime.reconnect();
  await expect(page.getByText("Соединение восстановлено. Автообновление снова работает.", { exact: true })).toBeVisible();
  rows.unshift(row(4)); realtime.change("responses", "INSERT", rows[0]);
  await expect(page.getByRole("cell", { name: "Новый ответ 4", exact: true })).toBeVisible();
  expect(app.pageErrors).toEqual([]);
});

test("templates update through realtime without a refresh button", async ({ page }) => {
  const app = await openSurveyApp(page);
  const realtime = await mockRealtime(page);
  const template = { ...app.form, form_type: "template", title: "Исходный шаблон" };
  let reads = 0;
  await page.route("**/list_forms_keyset*", route => { reads++; return route.fulfill({ json: [template] }); });
  await page.goto("/templates");
  await expect.poll(() => realtime.connected("templates:")).toBe(true);
  await expect.poll(() => reads).toBeGreaterThanOrEqual(2);
  await expect(page.getByText("Исходный шаблон", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Обновить", exact: true })).toHaveCount(0);
  template.title = "Изменённый шаблон"; realtime.change("forms", "UPDATE", template);
  await expect(page.getByText("Изменённый шаблон", { exact: true })).toBeVisible();
  expect(app.pageErrors).toEqual([]);
});
