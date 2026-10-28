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
