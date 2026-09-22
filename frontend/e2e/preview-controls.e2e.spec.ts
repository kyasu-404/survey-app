import { test, expect, type Locator } from "@playwright/test";
import { openSurveyApp } from "./fixtures/surveyApp";

const buttonStyle = (button: Locator) => button.evaluate(element => {
  const style = getComputedStyle(element);
  return { background: style.backgroundImage, color: style.color, radius: style.borderRadius, height: style.minHeight };
});

for (const theme of ["sand", "graphite"]) {
  test(`preview controls match export buttons and use fast entry and exit (${theme})`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.addInitScript(theme => localStorage.setItem("survey-app:theme", theme), theme);
    const app = await openSurveyApp(page, { responseCount: 1, elements: [{ type: "text", name: "name", title: "Имя" }] });
    await page.route("**/api/office/status", route => route.fulfill({ json: { enabled: false } }));
    await page.goto(`/dashboard/forms/${app.formId}/responses`);
    const expected = await buttonStyle(page.getByRole("button", { name: "Скачать XLSX", exact: true }));
    await page.getByRole("button", { name: /Открыть/ }).first().click();
    const response = page.locator(".response-preview-drawer");
    await expect(response).toBeVisible();
    expect(await buttonStyle(response.getByRole("button", { name: "Закрыть", exact: true }))).toEqual(expected);
    await expect(response).toHaveCSS("animation-duration", "0.15s");
    await response.getByRole("button", { name: "Закрыть", exact: true }).click();
    await expect(response).toHaveCount(0);
    const template = { ...app.form, id: "40000000-0000-4000-8000-000000000001", title: "Проверка шаблона", form_type: "template" };
    await page.route("**/list_forms_keyset*", route => route.fulfill({ json: [template] }));
    await page.route("**/rest/v1/forms?*", route => route.fulfill({ json: template }));
    await page.goto("/templates");
    const card = page.getByRole("button", { name: "Открыть превью шаблона Проверка шаблона", exact: true });
    await expect(card).toBeVisible();
    await expect(card.locator(".dashboard-status-pill-template")).toHaveCSS("background-color", "rgb(229, 231, 235)");
    await card.click();
    const preview = page.getByRole("dialog", { name: "Превью шаблона Проверка шаблона", exact: true });
    await expect(preview).toBeVisible();
    await expect(preview.locator(".sd-root-modern")).toBeVisible();
    expect(await buttonStyle(preview.getByRole("button", { name: "Закрыть", exact: true }))).toEqual(expected);
    await expect(preview.locator(".dashboard-status-pill-template")).toHaveCSS("background-color", "rgb(229, 231, 235)");
    await expect(preview).toHaveCSS("animation-duration", "0.15s");
    await page.screenshot({ path: testInfo.outputPath("template-preview.png") });
    const exit = await preview.evaluate(element => {
      element.querySelector<HTMLButtonElement>("button")!.click();
      return new Promise<{ duration: string; name: string }>(resolve => requestAnimationFrame(() => {
        const style = getComputedStyle(element); resolve({ duration: style.animationDuration, name: style.animationName });
      }));
    });
    expect(exit).toEqual({ duration: "0.15s", name: "app-drawer-leave" });
    await expect(preview).toHaveCount(0);
    expect(app.pageErrors).toEqual([]);
  });
}
