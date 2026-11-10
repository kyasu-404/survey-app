import { expect, test } from "@playwright/test";
import { openSurveyApp } from "./fixtures/surveyApp";

test("an author can change settings of an existing form without a separate metadata update", async ({ page }) => {
  const { formId, pageErrors } = await openSurveyApp(page, { responseCount: 0,
    elements: [{ type: "organization", name: "organization", title: "Организация" }],
  });
  const saves: Array<Record<string, any>> = [];
  await page.route("**/functions/v1/form-admin", async route => {
    saves.push(route.request().postDataJSON());
    await route.fulfill({ json: { status: "updated", safeChanges: [], warnings: [], breakingChanges: [] } });
  });
  await page.goto(`/builder/${formId}`);
  await page.getByRole("button", { name: "Настройки формы", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Настройки формы" });
  await dialog.getByLabel("Тип формы", { exact: true }).selectOption("monitoring");
  await dialog.getByLabel("Основание формы", { exact: true }).selectOption("order");
  await dialog.getByRole("switch", { name: "Редактирование ответов" }).click();
  await dialog.getByRole("checkbox", { name: "ОДО", exact: true }).check();
  await dialog.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard\/my$/);
  expect(saves).toHaveLength(1);
  expect(saves[0]).toMatchObject({ action: "update-schema", formId, expectedRevision: 0,
    allowResponseEditing: true, organizationTypes: ["school", "kindergarten", "odo"],
    settings: { formType: "monitoring", formReason: "order" },
  });
  expect(saves[0].settings).not.toHaveProperty("deadlineAt");
  expect(saves[0].settings).not.toHaveProperty("maxResponses");
  expect(pageErrors).toEqual([]);
});

test("public response status and renderer start loading before form metadata finishes", async ({ page }) => {
  const { formId, form, pageErrors } = await openSurveyApp(page, { responseCount: 0 });
  let release!: () => void;
  const metadataGate = new Promise<void>(resolve => { release = resolve; });
  let statusRequested = false;
  let rendererRequested = false;
  page.on("request", request => {
    if (request.url().includes("features/render-form/SurveyFormRenderer")) rendererRequested = true;
  });
  await page.route("**/rest/v1/forms?*", async route => {
    await metadataGate;
    await route.fulfill({ json: form });
  });
  await page.route("**/rest/v1/rpc/get_form_response_status", route => {
    statusRequested = true;
    return route.fulfill({ json: [] });
  });
  await page.goto(`/form/${formId}`, { waitUntil: "domcontentloaded" });
  try {
    await expect.poll(() => statusRequested).toBe(true);
    await expect.poll(() => rendererRequested).toBe(true);
    await expect(page.locator(".survey-page-skeleton")).toBeVisible();
  } finally { release(); }
  await expect(page.getByRole("textbox", { name: /Имя/ })).toBeVisible();
  expect(pageErrors).toEqual([]);
});
