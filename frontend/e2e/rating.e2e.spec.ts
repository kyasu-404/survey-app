import { expect, test } from "@playwright/test";
import { openSurveyApp } from "./fixtures/surveyApp";

test("star rating keeps selected stars filled and announces the saved value", async ({ page }) => {
  const { formId, pageErrors } = await openSurveyApp(page, { responseCount: 0, elements: [
    { type: "rating", name: "rating", title: "Рейтинг", ...{ rateType: "stars" } },
  ] });
  await page.goto(`/form/${formId}`);
  const feedback = page.locator(".survey-rating-feedback");
  const stars = page.locator(".sd-rating__item-star");
  await expect(feedback).toHaveText("Оценка не выбрана");
  await stars.nth(4).click();
  await expect(feedback).toHaveText("Выбрано: 5 из 5");
  await expect(stars.nth(4).locator("input")).toBeChecked();
  await expect(stars.nth(4).locator(".sv-star")).toHaveCSS("opacity", "1");
  await expect(stars.nth(4).locator(".sv-star-2")).toHaveCSS("opacity", "0");
  await expect(stars.nth(4).locator(".sv-star")).toHaveCSS("fill", "rgb(18, 18, 18)");
  // Hover is only a preview and must not change the announced answer.
  await stars.nth(1).hover();
  await expect(feedback).toHaveText("Выбрано: 5 из 5");
  await page.mouse.move(0, 0);
  await page.keyboard.press("ArrowLeft");
  await expect(feedback).toHaveText("Выбрано: 4 из 5");
  await page.reload();
  await expect(feedback).toHaveText("Выбрано: 4 из 5");
  await page.setViewportSize({ width: 390, height: 844 });
  await stars.nth(1).click();
  await expect(feedback).toHaveText("Выбрано: 2 из 5");
  expect(pageErrors).toEqual([]);
});
