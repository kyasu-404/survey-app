import { expect, test } from "@playwright/test";
import { openSurveyApp } from "./fixtures/surveyApp";

test("templates load SurveyJS only when a preview is opened", async ({ page }) => {
  const { form, pageErrors } = await openSurveyApp(page, { elements: [{ type: "text", name: "name", title: "Имя" }] });
  await page.route("**/list_forms_keyset*", route => route.fulfill({ json: [{ ...form, form_type: "template", title: "Ленивый шаблон" }] }));
  await page.goto("/templates");
  const card = page.getByRole("button", { name: "Открыть превью шаблона Ленивый шаблон", exact: true });
  await expect(card).toBeVisible();
  const surveyResources = () => page.evaluate(() => performance.getEntriesByType("resource")
    .map(resource => new URL(resource.name).pathname)
    .filter(path => /survey[-_](?:core|react|creator)|SurveyFormRenderer/.test(path)));
  expect(await surveyResources()).toEqual([]);
  await card.click();
  await expect(page.getByRole("dialog").getByText("Имя", { exact: false })).toBeVisible();
  expect((await surveyResources()).length).toBeGreaterThan(0);
  expect(pageErrors).toEqual([]);
});

test("an anonymous public form loads without dashboard, login or sidebar modules", async ({ page }) => {
  const { formId, pageErrors } = await openSurveyApp(page, { elements: [{ type: "text", name: "name", title: "Имя" }] });
  await page.evaluate(() => localStorage.clear());
  await page.goto(`/form/${formId}`);
  await expect(page.getByRole("textbox", { name: /Имя/ })).toBeVisible();
  const resources = await page.evaluate(() => performance.getEntriesByType("resource").map(resource => new URL(resource.name).pathname));
  expect(resources.filter(path => /DashboardPage|LoginPage|AppLayout|Sidebar/.test(path))).toEqual([]);
  expect(pageErrors).toEqual([]);
});
