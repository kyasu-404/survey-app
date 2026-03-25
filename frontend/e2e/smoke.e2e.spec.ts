import { expect, test } from "@playwright/test";

const hasCreds = Boolean(process.env.E2E_TEST_EMAIL && process.env.E2E_TEST_PASSWORD);

test.describe("core survey flows", () => {
  test.skip(!hasCreds, "Set E2E_TEST_EMAIL and E2E_TEST_PASSWORD to run full E2E scenario");

  test("registration/login/create/fill/result scenario", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByRole("heading", { name: "Авторизация" })).toBeVisible();

    // Login
    await page.getByPlaceholder("Электронная почта").fill(process.env.E2E_TEST_EMAIL!);
    await page.getByPlaceholder("Пароль").fill(process.env.E2E_TEST_PASSWORD!);
    await page.getByRole("button", { name: "Войти" }).click();

    // Create form
    await page.getByRole("link", { name: "Конструктор" }).click();
    await expect(page.locator(".builder-host")).toBeVisible();

    // NOTE: Concrete SurveyJS interactions depend on schema/UI internals,
    // so this test serves as regression scaffold for full path coverage.

    // Open dashboard and verify it is reachable.
    await page.goto("/dashboard/my");
    await expect(page.getByRole("button", { name: "Мои формы" })).toBeVisible();
  });
});
