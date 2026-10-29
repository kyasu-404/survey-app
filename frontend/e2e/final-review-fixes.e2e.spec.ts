import { expect, test } from "@playwright/test";
import { openSurveyApp } from "./fixtures/surveyApp";

test("deleting the only response on the last page returns to a usable first page", async ({ page }) => {
  const { formId, pageErrors, deletedBatchSizes } = await openSurveyApp(page, { responseCount: 51 });
  await page.goto(`/dashboard/forms/${formId}/responses`);
  await page.getByRole("button", { name: "Далее", exact: true }).click();
  await expect(page.getByText("Страница 2 из 2")).toBeVisible();
  await page.getByRole("checkbox", { name: "Выбрать ответы на странице", exact: true }).check();
  page.on("dialog", dialog => dialog.accept());
  await page.getByRole("button", { name: "Удалить", exact: true }).click();
  await expect(page.getByText("Ответов: 50", { exact: true })).toBeVisible();
  await expect(page.locator(".responses-table tbody tr")).toHaveCount(50);
  expect(deletedBatchSizes).toEqual([1]);
  expect(pageErrors).toEqual([]);
});

test("legacy malformed nested signatures and report values cannot crash staff responses", async ({ page }) => {
  const bad = { toString: "malformed", valueOf: null };
  const { formId, pageErrors } = await openSurveyApp(page, { responseCount: 1,
    elements: [
      { type: "paneldynamic", name: "p", title: "Панель", templateElements: [{ type: "signaturepad", name: "sig", title: "Подпись" }] },
      { type: "text", inputType: "number", name: "n", title: "Количество" },
      { type: "text", inputType: "date", name: "d", title: "Дата" },
      { type: "text", inputType: "time", name: "t", title: "Время" },
      { type: "ranking", name: "r", title: "Рейтинг", choices: ["A"] },
    ], responseData: [{ p: [{ sig: bad }], n: bad, d: bad, t: bad, r: [bad] }],
  });
  await page.goto(`/dashboard/forms/${formId}/responses`);
  await expect(page.locator(".responses-table tbody tr")).toHaveCount(1);
  await page.getByRole("button", { name: "Отчёт", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Отчёт по ответам" })).toBeVisible();
  await page.goto(`/dashboard/forms/${formId}/responses/html`);
  await expect(page.locator(".responses-report-screen tbody tr")).toHaveCount(1);
  expect(pageErrors).toEqual([]);
});

for (const storage of ["sessionStorage", "localStorage"]) {
  test(`public submission remains usable with blocked ${storage}`, async ({ page }) => {
    const { formId, pageErrors } = await openSurveyApp(page, { responseCount: 0,
      elements: [{ type: "text", name: "answer", title: "Ответ" }],
    });
    await page.route("**/rest/v1/rpc/get_form_response_status", route => route.fulfill({ json: [] }));
    await page.route("**/rest/v1/rpc/submit_form_response", route => route.fulfill({ json: [{ status: "submitted", response_id: "30000000-0000-4000-8000-000000000001", response_data: { answer: "Работает без черновика" }, response_editable: false }] }));
    await page.addInitScript(storageName => {
      Object.defineProperty(window, storageName, { configurable: true, get() { throw new DOMException("Blocked", "SecurityError"); } });
    }, storage);
    await page.goto(`/form/${formId}`);
    await expect(page.locator(".sd-input").first()).toBeVisible();
    await page.locator(".sd-input").first().fill("Работает без черновика");
    await page.getByRole("button", { name: "Отправить", exact: true }).click();
    await expect(page.getByText("Спасибо", { exact: false }).first()).toBeVisible();
    expect(pageErrors).toEqual([]);
  });
}
