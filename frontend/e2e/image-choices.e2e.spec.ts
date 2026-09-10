import { expect, test, type Locator } from "@playwright/test";
import { openSurveyApp } from "./fixtures/surveyApp";

test("two uploaded image choices keep their files and values after saving, reopening, preview, and public rendering", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  const { formId, form, pageErrors } = await openSurveyApp(page, { responseCount: 0, elements: [
    { type: "imagepicker", name: "logos", title: "Выберите логотип", choices: ["Пункт 1", "Пункт 2"] },
  ] });
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=", "base64");
  const uploads: string[] = [];
  await page.route("**/storage/v1/object/**", async route => {
    const path = new URL(route.request().url()).pathname;
    if (route.request().method() === "POST") {
      const assetPath = path.split("/object/survey-assets/")[1];
      uploads.push(assetPath);
      return route.fulfill({ json: { Key: `survey-assets/${assetPath}` } });
    }
    return route.fulfill({ contentType: "image/png", body: png });
  });
  await page.goto(`/builder/${formId}`);
  await expect(page.locator(".svc-creator")).toBeVisible();
  for (let index = 0; index < 2; index += 1) {
    const item = page.locator(".svc-image-item-value-wrapper").nth(index);
    const chooser = page.waitForEvent("filechooser");
    await item.locator(".svc-image-item-value-controls .svc-context-button").first().click();
    await (await chooser).setFiles({ name: `logo-${index}.png`, mimeType: "image/png", buffer: png });
    await expect.poll(() => uploads.length).toBe(index + 1);
    await expect(item.locator("img")).toHaveAttribute("src", new RegExp(uploads[index]));
  }
  const verify = async (surface: Locator) => {
    const images = surface.locator("img.sd-imagepicker__image");
    await expect(images).toHaveCount(2);
    for (let index = 0; index < 2; index += 1) {
      await expect(images.nth(index)).toHaveAttribute("src", new RegExp(uploads[index]));
      await expect.poll(() => images.nth(index).evaluate(img => (img as HTMLImageElement).naturalWidth)).toBe(1);
    }
  };
  await page.getByRole("button", { name: "Сохранить опрос", exact: true }).click();
  await expect(page).toHaveURL(/dashboard/);
  expect(form.schema.pages[0].elements[0].choices).toEqual(uploads.map((path, index) => ({ value: `Пункт ${index + 1}`, imageLink: `__APP_SURVEY_ASSET__/${path}` })));
  await page.goto(`/builder/${formId}`);
  await verify(page.locator(".svc-tab-designer"));
  await page.getByText("Превью", { exact: true }).click();
  await verify(page.getByTestId("builder-preview-tab"));
  await page.goto(`/form/${formId}`);
  await verify(page.locator(".survey-page-card"));
  await page.locator(".sd-imagepicker__label").nth(1).click();
  await expect(page.locator(".sd-imagepicker__control").nth(1)).toBeChecked();
  expect(pageErrors).toEqual([]);
});
