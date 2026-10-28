import { expect, test } from "@playwright/test";
import { openSurveyApp } from "./fixtures/surveyApp";

test("page titles entered before the first question survive the first save and reopening", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  const { formId, form, pageErrors } = await openSurveyApp(page, { responseCount: 0, elements: [] });
  await page.goto(`/builder/${formId}`);
  const designer = page.locator(".svc-tab-designer");
  await expect(page.locator(".svc-creator")).toBeVisible();
  const titleEditors = designer.getByRole("textbox", { name: "Введите заголовок страницы", exact: true });
  const titles = ["Страница 1", "Страница 2", "Page 3", "Информационная безопасность"];
  for (const [index, title] of titles.entries()) {
    // Editing the trailing placeholder creates a page and another placeholder.
    // Keep targeting that page after SurveyJS updates the editor collection.
    const editor = titleEditors.nth(index);
    await editor.fill(title);
    await editor.press("Tab");
    await page.locator(".svc-toolbox").getByText("Текст", { exact: true }).click();
    await expect(designer.getByRole("textbox", { name: /^вопрос\d+$/, exact: false })).toHaveCount(index + 1);
  }
  // Leave one actual page untitled: its placeholder must never become saved text.
  await titleEditors.nth(4).fill("Временная страница");
  await titleEditors.nth(4).press("Tab");
  await page.locator(".svc-toolbox").getByText("Текст", { exact: true }).click();
  await expect(designer.getByRole("textbox", { name: /^вопрос\d+$/, exact: false })).toHaveCount(5);
  await titleEditors.nth(4).fill("");
  await titleEditors.nth(4).press("Tab");
  await page.getByRole("button", { name: "Сохранить опрос", exact: true }).click();
  await expect(page).toHaveURL(/dashboard/);
  expect(form.schema.pages.map(p => p.title ?? "")).toEqual([...titles, ""]);
  expect(form.schema.pages.map(p => p.elements.length)).toEqual([1, 1, 1, 1, 1]);
  await page.goto(`/builder/${formId}`);
  await expect(page.locator(".svc-creator")).toBeVisible();
  for (const title of titles) {
    await expect(designer.getByRole("textbox", { name: "Введите заголовок страницы", exact: true }).filter({ hasText: title })).toHaveCount(1);
  }
  expect(form.schema.pages.map(p => p.title ?? "")).toEqual([...titles, ""]);
  expect(pageErrors).toEqual([]);
});
