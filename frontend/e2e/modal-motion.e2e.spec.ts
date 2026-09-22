import { expect, test, type Locator } from "@playwright/test";
import { openSurveyApp } from "./fixtures/surveyApp";

async function settleOpening(dialog: Locator) {
  await expect(dialog).toBeVisible();
  await dialog.evaluate(async element => {
    await Promise.all(element.getAnimations().map(animation => animation.finished));
  });
}

// Watch every frame, including the first switch and asynchronous content changes.
async function startGeometryWatch(dialog: Locator) {
  await dialog.evaluate(element => {
    const tabs = element.querySelector('[role="tablist"]')!;
    const boxes = () => [element, tabs].flatMap(node => {
      const { x, y, width, height } = node.getBoundingClientRect();
      return [x, y, width, height];
    });
    const initial = boxes();
    element.setAttribute("data-max-layout-shift", "0");
    element.setAttribute("data-watch-layout", "true");
    const measure = () => {
      const shift = Math.max(...boxes().map((value, index) => Math.abs(value - initial[index])));
      element.setAttribute("data-max-layout-shift", String(Math.max(shift, Number(element.getAttribute("data-max-layout-shift")))));
      if (element.hasAttribute("data-watch-layout")) requestAnimationFrame(measure);
    };
    requestAnimationFrame(measure);
  });
}

async function expectStableGeometry(dialog: Locator) {
  const shift = await dialog.evaluate(async element => {
    await new Promise(requestAnimationFrame);
    element.removeAttribute("data-watch-layout");
    return Number(element.getAttribute("data-max-layout-shift"));
  });
  expect(shift).toBeLessThan(1);
}

for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
  test(`report tabs stay in place across short and long content at ${viewport.width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    const { formId, pageErrors } = await openSurveyApp(page, {
      responseCount: 1,
      elements: [
        { type: "organization", name: "organization", title: "Организация" },
        ...Array.from({ length: 12 }, (_, index) => ({ type: "text", name: `q${index}`, title: `Вопрос ${index + 1}` })),
      ],
    });
    await page.goto(`/dashboard/forms/${formId}/responses`);
    await page.getByRole("button", { name: "Отчёт", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Отчёт по ответам" });
    await settleOpening(dialog);
    await startGeometryWatch(dialog);
    const panel = dialog.getByRole("tabpanel");
    expect(await panel.evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true);
    await panel.evaluate(element => { element.scrollTop = element.scrollHeight; });
    await expect(dialog.getByRole("tab", { name: "Учёт сдавших" })).toBeInViewport();
    for (let index = 0; index < 3; index++) {
      await dialog.getByRole("tab", { name: "Учёт сдавших" }).click();
      await expect(dialog.getByRole("heading", { name: "Статус сдачи" })).toBeVisible();
      await dialog.getByRole("tab", { name: "Статистика" }).click();
      await expect(panel.getByText("Вопрос 1", { exact: true })).toBeVisible();
    }
    await expectStableGeometry(dialog);
    await expect(dialog.getByRole("button", { name: "Закрыть", exact: true })).toBeInViewport();
    await page.screenshot({ path: testInfo.outputPath("report.png") });
    expect(pageErrors).toEqual([]);
  });

  test(`documents keep their size during first results load and scrolling at ${viewport.width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    const { formId, pageErrors } = await openSurveyApp(page, { responseCount: 1 });
    let releaseResults!: () => void;
    const resultsReady = new Promise<void>(resolve => { releaseResults = resolve; });
    await page.route("**/api/office/**", async route => {
      const path = new URL(route.request().url()).pathname;
      if (path.endsWith("/status")) return route.fulfill({ json: { enabled: true } });
      if (path.endsWith("/documents")) return route.fulfill({ json: {
        enabled: true, response_count: 1, documents: [{ id: "doc-1", name: "Макет.xlsx", file_type: "xlsx", updated_at: "2026-09-14T12:00:00Z", binding_count: 1, size_bytes: 1024 }],
      } });
      if (path.endsWith("/results")) {
        await resultsReady;
        return route.fulfill({ json: { jobs: [], results: [{
          id: "result-1", name: "Документы.zip", file_type: "xlsx", created_at: "2026-09-14T12:00:00Z", files: Array.from({ length: 30 }, (_, index) => `${index + 1}.xlsx`),
        }] } });
      }
      return route.fulfill({ status: 404, json: { message: "Unexpected request" } });
    });
    await page.goto(`/dashboard/forms/${formId}/responses`);
    await page.getByRole("button", { name: "Документы", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Документы", exact: true });
    await settleOpening(dialog);
    await expect(dialog.getByText("Макет.xlsx", { exact: true })).toBeVisible();
    await startGeometryWatch(dialog);
    await dialog.getByRole("tab", { name: "Результат", exact: true }).click();
    await expect(dialog.getByText("Загрузка результатов…")).toBeVisible();
    releaseResults();
    await expect(dialog.getByRole("button", { name: /^Скачать \d+\.xlsx$/ })).toHaveCount(30);
    const panel = dialog.getByRole("tabpanel");
    expect(await panel.evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true);
    await panel.evaluate(element => { element.scrollTop = element.scrollHeight; });
    await expect(dialog.getByRole("button", { name: "Скачать 30.xlsx", exact: true })).toBeInViewport();
    await expect(dialog.getByRole("tab", { name: "Макеты", exact: true })).toBeInViewport();
    for (let index = 0; index < 3; index++) {
      await dialog.getByRole("tab", { name: "Макеты", exact: true }).click();
      await dialog.getByRole("tab", { name: "Результат", exact: true }).click();
    }
    await expectStableGeometry(dialog);
    await page.screenshot({ path: testInfo.outputPath("documents.png") });
    await dialog.getByRole("button", { name: "Закрыть документы" }).click();
    await expect(page.locator(".office-dialog")).toHaveCount(0);
    expect(pageErrors).toEqual([]);
  });
}
