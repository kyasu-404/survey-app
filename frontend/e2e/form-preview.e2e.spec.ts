import { test, expect } from "@playwright/test";
import { openSurveyApp } from "./fixtures/surveyApp";

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=", "base64");

async function isBlobAvailable(url: string | null) {
  try { await fetch(url!); return true; }
  catch { return false; }
}

test("preview keeps files local, allows required-file navigation and returns to the same filtered list position", async ({ page }, testInfo) => {
  const { pageErrors } = await openSurveyApp(page, { responseCount: 0, pages: [
    { name: "upload", elements: [{ type: "file", name: "attachment", title: "Обязательный файл", isRequired: true, needConfirmRemoveFile: false }] },
    { name: "choices", elements: [{ type: "dropdown", name: "choice", title: "Выпадающий список", choices: ["Первый", "Второй"], searchEnabled: true, isRequired: true }] },
  ] });
  const mutations: string[] = [];
  page.on("request", request => {
    if (request.method() !== "GET" && /\/storage\/v1\/|\/functions\/v1\/|\/rest\/v1\/(responses|rpc\/submit)/.test(request.url())) mutations.push(request.url());
  });
  await page.getByRole("link", { name: "Все формы", exact: true }).click();
  const originalUrl = page.url();
  const filteredList = page.waitForResponse(response => {
    const url = new URL(response.url());
    return url.pathname.endsWith("/list_forms_keyset") && url.searchParams.get("or")?.includes("Карточка") && url.searchParams.getAll("form_type").includes("eq.anketa");
  });
  await page.getByPlaceholder("Поиск по названию и автору").fill("Карточка");
  await page.getByLabel("Тип формы", { exact: true }).selectOption("anketa");
  await filteredList;
  await expect(page.locator(".dashboard-form-card")).toHaveCount(20);
  await page.getByRole("button", { name: "Показать ещё" }).click();
  await expect(page.locator(".dashboard-form-card")).toHaveCount(40);
  const card = page.locator(".dashboard-form-card").nth(30);
  await card.click({ trial: true });
  const scrollBefore = await page.evaluate(() => scrollY);
  await card.click();
  await expect(page.getByText("Открыт предпросмотр формы", { exact: true })).toHaveClass("toast toast-warning");
  await expect(page.locator(".survey-preview-toolbar").getByRole("button", { name: "Назад", exact: true })).toBeVisible();

  const chooser = page.waitForEvent("filechooser");
  await page.locator(".sd-file label[for]").click();
  await (await chooser).setFiles({ name: "preview.png", mimeType: "image/png", buffer: png });
  await expect(page.locator(".sd-file img")).toHaveAttribute("src", /^blob:/);
  const removedUrl = await page.locator(".sd-file img").getAttribute("src");
  await page.locator(".sd-file").getByRole("button", { name: "Очистить", exact: true }).click();
  await expect(page.locator(".sd-file img")).toHaveCount(0);
  expect(await page.evaluate(isBlobAvailable, removedUrl)).toBe(false);
  await page.getByRole("button", { name: "Далее", exact: true }).click();
  await expect(page.locator(".sd-question__erbox")).toBeVisible();
  const replacement = page.waitForEvent("filechooser");
  await page.locator(".sd-file label[for]").click();
  await (await replacement).setFiles({ name: "replacement.png", mimeType: "image/png", buffer: png });
  await expect(page.locator(".sd-file img")).toHaveAttribute("src", /^blob:/);
  const localUrl = await page.locator(".sd-file img").getAttribute("src");
  await expect(page.locator(".sd-question__erbox")).toHaveCount(0);
  await page.getByRole("button", { name: "Далее", exact: true }).click();
  const search = page.locator(".sd-dropdown input[role=combobox]");
  await expect(search).toBeVisible();
  await page.locator(".sd-dropdown").click();
  await search.fill("Втор");
  await page.getByRole("option", { name: "Второй", exact: true }).click();
  await search.focus();
  const decoration = await search.evaluate(element => {
    const css = getComputedStyle(element);
    return { background: css.backgroundColor, border: css.borderWidth, radius: css.borderRadius, shadow: css.boxShadow };
  });
  expect(decoration).toEqual({ background: "rgba(0, 0, 0, 0)", border: "0px", radius: "0px", shadow: "none" });
  await page.screenshot({ path: testInfo.outputPath("preview-dropdown.png") });
  await page.getByRole("button", { name: "Отправить", exact: true }).click();
  await expect(page.locator(".sd-completedpage")).toBeVisible();
  expect(mutations).toEqual([]);
  await page.locator(".survey-preview-toolbar").getByRole("button", { name: "Назад", exact: true }).click();
  await expect(page).toHaveURL(originalUrl);
  expect(await page.evaluate(isBlobAvailable, localUrl)).toBe(false);
  await expect(page.getByPlaceholder("Поиск по названию и автору")).toHaveValue("Карточка");
  await expect(page.getByLabel("Тип формы", { exact: true })).toHaveValue("anketa");
  await expect(page.locator(".dashboard-form-card")).toHaveCount(40);
  const savedScroll = await page.evaluate(() => window.history.state.usr.dashboardView.scroll.top);
  // The card's hover animation can shift the click target by two pixels.
  expect(Math.abs(savedScroll - scrollBefore)).toBeLessThanOrEqual(2);
  await expect.poll(() => page.evaluate(() => scrollY)).toBe(savedScroll);
  await page.locator(".dashboard-form-card").nth(30).click();
  await expect(page.locator(".sd-file label[for]")).toBeVisible();
  await page.reload();
  await expect(page.locator(".survey-preview-toolbar").getByRole("button", { name: "Назад", exact: true })).toBeVisible();
  await page.locator(".survey-preview-toolbar").getByRole("button", { name: "Назад", exact: true }).click();
  await expect(page).toHaveURL(originalUrl);
  await expect(page.locator(".dashboard-form-card")).toHaveCount(40);
  await expect(page.getByPlaceholder("Поиск по названию и автору")).toHaveValue("Карточка");
  expect(pageErrors).toEqual([]);
});
