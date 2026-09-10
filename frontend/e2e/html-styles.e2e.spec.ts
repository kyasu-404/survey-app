import { expect, test, type Locator } from "@playwright/test";
import type { SurveyQuestion } from "../src/entities/survey/types";
import { openSurveyApp } from "./fixtures/surveyApp";

const html = `<div class="html-code"><span class="bracket">&lt;</span> Это HTML-код <span class="bracket">/&gt;</span></div>
<style>
.html-code {display:inline-block;padding:18px 32px;font-family:Consolas,"Courier New",monospace;
font-size:42px;font-weight:900;letter-spacing:2px;background:linear-gradient(90deg,#00ffff,#7c4dff,#ff00cc,#00ff88,#00ffff);
background-size:300% 100%;background-clip:text;-webkit-background-clip:text;color:transparent;-webkit-text-fill-color:transparent;
filter:drop-shadow(0 0 5px #00ffff) drop-shadow(0 0 14px #7c4dff);animation:gradientMove 4s linear infinite,floating 2.5s ease-in-out infinite}
.html-code .bracket {font-size:1.2em}
@keyframes gradientMove {0%{background-position:0% 50%}100%{background-position:300% 50%}}
@keyframes floating {0%,100%{transform:translateY(0) rotate(-1deg)}50%{transform:translateY(-6px) rotate(1deg)}}
body, button, input {color:rgb(1,2,3)!important;background:rgb(4,5,6)!important}
@import url(https://attacker.test/style.css);
.html-code {background-image:url(https://attacker.test/tracker)}
</style>`;

test("HTML gradient, glow, and scoped animation work in designer, preview, and public form without changing other controls", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  const { formId, form, pageErrors } = await openSurveyApp(page, { responseCount: 0, elements: [
    { type: "html", name: "markup", html } as unknown as SurveyQuestion,
    { type: "html", name: "separate", html: '<div class="html-code">Соседний HTML без стилей</div>' } as unknown as SurveyQuestion,
    { type: "text", name: "answer", title: "Обычный вопрос" },
  ] });
  const foreignRequests: string[] = [];
  page.on("request", request => { if (request.url().includes("attacker.test")) foreignRequests.push(request.url()); });
  const verify = async (surface: Locator) => {
    const styled = surface.locator(".html-code").first();
    await expect(styled).toHaveCSS("background-image", /linear-gradient/);
    await expect(styled).toHaveCSS("background-clip", "text");
    await expect(styled).toHaveCSS("filter", /drop-shadow/);
    await expect(styled).toHaveCSS("padding-left", "32px");
    await expect(styled).toHaveCSS("font-size", "42px");
    await expect(styled).toHaveCSS("font-weight", "900");
    await expect(styled).toHaveCSS("animation-name", /^survey-html-\d+-animation-\d+, survey-html-\d+-animation-\d+$/);
    const animations = await styled.evaluate(element => element.getAnimations().length);
    expect(animations).toBe(2);
    await expect(surface.locator(".html-code").nth(1)).toHaveCSS("background-image", "none");
    await expect(surface.locator(".html-code").nth(1)).toHaveCSS("animation-name", "none");
    await expect(page.locator("body")).not.toHaveCSS("background-color", "rgb(4, 5, 6)");
    await expect(surface.locator("input").last()).not.toHaveCSS("color", "rgb(1, 2, 3)");
  };
  await page.goto(`/builder/${formId}`);
  await verify(page.locator(".svc-tab-designer"));
  await page.getByRole("textbox", { name: "Введите заголовок опроса", exact: true }).fill("Проверка оформления HTML");
  await page.getByRole("textbox", { name: "Введите заголовок опроса", exact: true }).press("Tab");
  await page.getByRole("button", { name: "Сохранить опрос", exact: true }).click();
  await expect(page).toHaveURL(/dashboard/);
  expect((form.schema.pages[0].elements[0] as unknown as { html: string }).html).toBe(html);
  await page.goto(`/builder/${formId}`);
  await page.getByText("Превью", { exact: true }).click();
  await verify(page.getByTestId("builder-preview-tab"));
  await page.goto(`/form/${formId}`);
  await verify(page.locator(".survey-page-card"));
  await page.screenshot({ path: testInfo.outputPath("html-styles-public.png"), fullPage: true });
  expect(foreignRequests).toEqual([]);
  expect(pageErrors).toEqual([]);
});
