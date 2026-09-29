import { expect, test } from "@playwright/test";
import { openSurveyApp } from "./fixtures/surveyApp";

for (const width of [1440, 390]) {
  test(`settings retain the active tab and drafts after browser focus at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    const app = await openSurveyApp(page);
    const writes: string[] = [];
    await page.route("**/functions/v1/mail-admin", route => {
      const action = route.request().postDataJSON().action;
      if (action !== "get-settings") writes.push(action);
      return route.fulfill({ json: { settings: {
        enabled: true, host: "smtp.example.test", port: 465, sslMode: "tls",
        username: "mail@example.test", fromEmail: "mail@example.test",
        fromName: "Формы", replyTo: "", hasPassword: true,
      } } });
    });
    await page.route("**/functions/v1/form-admin", route =>
      route.request().postDataJSON().action === "get-cleanup-status"
        ? route.fulfill({ json: { retentionHours: 168, lastRun: null } })
        : route.fallback());
    await page.route("**/api/office/settings", route => {
      if (route.request().method() !== "GET") writes.push("office-settings");
      return route.fulfill({ json: {
        enabled: true, public_url: "https://docs.example.test", internal_url: "",
        storage_url_override: "", jwt_header: "Authorization", jwt_prefix: "Bearer ",
        max_file_mb: 25, max_table_rows: 1000, has_secret: true,
      } });
    });
    await page.goto("/settings");
    await page.getByRole("tab", { name: "ONLYOFFICE", exact: true }).click();
    await expect(page.getByLabel("Публичный адрес Document Server")).toHaveValue("https://docs.example.test");
    await page.getByLabel("Публичный адрес Document Server").fill("https://draft.example.test");
    await page.getByLabel("JWT Secret", { exact: true }).fill("unsaved-test-secret");
    const notice = page.locator(".toast-warning", { hasText: "Для применения сохраните настройки" });
    await expect(notice).toHaveCount(0);
    await page.getByRole("tabpanel", { name: "ONLYOFFICE", exact: true }).locator(".smtp-enable-control").click();
    await expect(page.getByRole("checkbox", { name: "Коннектор выключен", exact: true })).not.toBeChecked();
    await expect(notice).toBeVisible();
    await expect(notice).toHaveCount(0);

    await page.getByRole("tab", { name: "SMTP", exact: true }).click();
    await expect(page.getByRole("textbox", { name: "SMTP-сервер" })).toHaveValue("smtp.example.test");
    await page.getByRole("textbox", { name: "SMTP-сервер" }).fill("smtp.draft.test");
    await expect(notice).toHaveCount(0);
    await page.getByRole("tabpanel", { name: "SMTP", exact: true }).locator(".smtp-enable-control").click();
    await expect(page.getByRole("checkbox", { name: "Коннектор выключен", exact: true })).not.toBeChecked();
    await expect(notice).toBeVisible();

    // The real auth client rechecks the session when the browser tab becomes visible.
    // Hold the profile response to verify the form survives the entire recheck.
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    let profileReads = 0;
    await page.route("**/rest/v1/profiles?*", async route => {
      profileReads++;
      await gate;
      await route.fallback();
    });
    const profileResponse = page.waitForResponse(response => response.url().includes("/rest/v1/profiles?"));
    await page.evaluate(() => {
      for (const state of ["hidden", "visible"]) {
        Object.defineProperty(document, "visibilityState", { configurable: true, value: state });
        window.dispatchEvent(new Event("visibilitychange"));
      }
    });
    try {
      await expect.poll(() => profileReads).toBeGreaterThan(0);
      await expect(page.getByRole("tab", { name: "SMTP", exact: true })).toHaveAttribute("aria-selected", "true");
      await expect(page.getByRole("textbox", { name: "SMTP-сервер" })).toHaveValue("smtp.draft.test");
    } finally {
      release();
    }
    await (await profileResponse).finished();
    await expect(page.getByRole("tab", { name: "SMTP", exact: true })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("checkbox", { name: "Коннектор выключен", exact: true })).not.toBeChecked();
    await expect(page.getByRole("button", { name: "Сохранить настройки", exact: true })).toBeEnabled();
    await page.getByRole("tab", { name: "ONLYOFFICE", exact: true }).click();
    await expect(page.getByLabel("Публичный адрес Document Server")).toHaveValue("https://draft.example.test");
    await expect(page.getByLabel("JWT Secret", { exact: true })).toHaveValue("unsaved-test-secret");
    await expect(page.getByRole("checkbox", { name: "Коннектор выключен", exact: true })).not.toBeChecked();
    await page.getByRole("tab", { name: "SMTP", exact: true }).click();
    await expect(page.getByRole("textbox", { name: "SMTP-сервер" })).toHaveValue("smtp.draft.test");
    expect(writes).toEqual([]);
    expect(app.pageErrors).toEqual([]);
  });
}
