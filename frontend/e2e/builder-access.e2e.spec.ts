import { expect, test } from "@playwright/test";
import { openSurveyApp } from "./fixtures/surveyApp";

for (const responseCount of [0, 2]) {
  test(`shared read cache cannot authorize a foreign builder (${responseCount} responses)`, async ({ page }) => {
    const { form, formId, pageErrors, realtime } = await openSurveyApp(page, { responseCount });
    form.author_id = "10000000-0000-4000-8000-000000000002";
    await page.route("**/rest/v1/profiles?*", route => route.fulfill({ json: {
      id: "10000000-0000-4000-8000-000000000001", name: "Employee", email: "test@example.test",
      role: "user", is_disabled: false, created_at: "2026-01-01T00:00:00Z",
    } }));
    let formReads = 0;
    await page.route("**/rest/v1/forms?*", route => {
      formReads++;
      return route.fulfill({ json: { ...form, responses_count: responseCount } });
    });
    await page.goto(`/dashboard/forms/${formId}/responses`);
    await expect(page.getByRole("button", { name: "Отчёт", exact: true })).toBeVisible();
    // Subscription recovery refreshes the reader once; finish that read first.
    await expect.poll(() => realtime.connected("form-responses:")).toBe(true);
    await expect.poll(() => formReads).toBe(2);

    // Stay in the same SPA/QueryClient, as when opening a bookmarked builder URL.
    await page.evaluate(id => {
      history.pushState(null, "", `/builder/${id}`);
      dispatchEvent(new PopStateEvent("popstate"));
    }, formId);
    await expect(page.getByRole("alert")).toHaveText("У вас нет прав на редактирование этой формы");
    expect(formReads).toBe(2);
    await expect(page.locator(".builder-host")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Создать копию", exact: true })).toHaveCount(0);
    expect(pageErrors).toEqual([]);
  });
}

test("a failed save shows one helpful message and can be retried with the edited form", async ({ page }) => {
  await page.setViewportSize({ width: 1680, height: 1000 });
  const { formId, pageErrors } = await openSurveyApp(page, {
    responseCount: 0,
    elements: [{ type: "text", name: "name", title: "Имя" }],
  });
  const savedTitles: string[] = [];
  await page.route("**/functions/v1/form-admin", async (route) => {
    savedTitles.push(route.request().postDataJSON().title);
    if (savedTitles.length === 1) {
      await route.abort("connectionreset");
      return;
    }
    await route.fulfill({ json: { status: "updated", safeChanges: [], warnings: [], breakingChanges: [] } });
  });

  await page.goto(`/builder/${formId}`);
  const grid = page.locator(".svc-side-bar__container");
  const general = grid.getByRole("button", { name: "Общие", exact: true });
  if (await general.getAttribute("aria-expanded") !== "true") await general.click();
  const title = grid.getByRole("textbox", { name: "Название опроса", exact: true });
  const save = page.getByRole("button", { name: "Сохранить опрос", exact: true });
  await title.fill("Название после правки");
  await title.press("Tab");
  await save.click();

  await expect(page.getByText(
    "Не удалось сохранить форму. Проверьте соединение и повторите попытку. Несохранённые изменения остались в редакторе.",
    { exact: true },
  )).toBeVisible();
  await expect(page.getByText("Ошибка! Содержание редактора не сохранено.")).toHaveCount(0);
  await expect(title).toHaveValue("Название после правки");
  await expect(save).toBeEnabled();

  await save.click();
  await expect(page).toHaveURL(/\/dashboard\/my$/);
  expect(savedTitles).toEqual(["Название после правки", "Название после правки"]);
  expect(pageErrors).toEqual([]);
});
