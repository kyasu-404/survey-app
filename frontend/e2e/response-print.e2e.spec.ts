import { expect, test } from "@playwright/test";
import { openSurveyApp } from "./fixtures/surveyApp";

test("wide HTML scrolls on screen and prints all answers in A4 landscape blocks with repeated dates", async ({ page }, testInfo) => {
  const questions = (start: number, count: number) => Array.from({ length: count }, (_, index) => ({
    type: "text", name: `q${start + index}`, title: `Вопрос ${start + index}. Комментарий, если не выполнено`,
  }));
  const responseData = Array.from({ length: 35 }, (_, index) => ({
    ...Object.fromEntries(questions(1, 18).map((question, q) => [question.name, `Ответ ${index + 1}, поле ${q + 1}`])),
    legacy: `Архивный ответ ${index + 1}`,
  }));
  const { formId, pageErrors } = await openSurveyApp(page, { responseCount: 35, responseData, pages: [
    { title: "Страница", elements: [
      ...questions(1, 2),
      { type: "sectiontitle", name: "s1", title: "Раздел" }, ...questions(3, 3),
      { type: "sectiontitle", name: "s2", title: "Раздел" }, ...questions(6, 9),
    ] },
    { elements: questions(15, 4) },
    { title: "Пустая страница", elements: [{ type: "sectiontitle", name: "empty", title: "Пустой раздел" }] },
  ] });
  await page.goto(`/dashboard/forms/${formId}/responses/html`);
  const screenTable = page.locator(".responses-report-screen");
  await expect(screenTable.locator("tbody tr")).toHaveCount(35);
  await expect(page.locator(".responses-report-print")).toBeHidden();
  const wrap = screenTable.locator(".responses-table-wrap");
  expect(await wrap.evaluate(node => node.scrollWidth > node.clientWidth)).toBe(true);
  expect(await screenTable.locator("th").nth(2).evaluate(node => node.getBoundingClientRect().width)).toBeGreaterThanOrEqual(180);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await wrap.evaluate(node => { node.scrollLeft = node.scrollWidth; });
  await expect(screenTable.getByText("Архивный ответ 1", { exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("wide-report-screen.png"), fullPage: true });

  const htmlDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Скачать HTML" }).click();
  const chunks: Buffer[] = [];
  for await (const chunk of (await (await htmlDownload).createReadStream())!) chunks.push(Buffer.from(chunk));
  const html = Buffer.concat(chunks).toString("utf8");
  const standalone = await page.context().newPage();
  await standalone.setContent(html);
  await expect(standalone.locator(".responses-report-print")).toBeHidden();
  await page.getByRole("button", { name: "Скрыть меню", exact: true }).click();
  for (const target of [page, standalone]) {
    await target.emulateMedia({ media: "print" });
    await expect(target.locator(".responses-report-screen")).toBeHidden();
    const blocks = target.locator(".responses-print-block");
    await expect(blocks).toHaveCount(7);
    const expectedCounts = [2, 3, 8, 1, 4, 1, 1];
    for (let index = 0; index < expectedCounts.length; index += 1) {
      const block = blocks.nth(index);
      await expect(block).toBeVisible();
      await expect(block.locator("thead tr").last().locator("th")).toHaveCount(expectedCounts[index] + 1);
      await expect(block.locator("th.responses-table-date-column")).toHaveText("Дата ответа");
      expect(await block.locator("th.responses-table-date-column").evaluate(node => node.getBoundingClientRect().width)).toBeLessThan(90);
      await expect(block.locator("tbody tr")).toHaveCount(35);
      await expect(block.locator("thead")).toHaveCSS("display", "table-header-group");
    }
    await expect(blocks.nth(4)).toContainText("Страница 2");
    await expect(blocks.nth(5)).toContainText("Пустая страница");
    await expect(blocks.nth(5)).toContainText("Пустой раздел");
    await expect(blocks.nth(6)).toContainText("Архивный ответ 35");
    expect(await target.locator(".responses-report-print tbody tr:last-child td:not(.responses-table-date-column)").allTextContents()).toEqual([
      ...questions(1, 18).map((_, index) => `Ответ 35, поле ${index + 1}`), "", "Архивный ответ 35",
    ]);
  }
  await expect(page.locator(".responses-html-actions")).toBeHidden();
  await expect(page.locator(".app-main")).toHaveCSS("padding-left", "0px");
  await expect(page.locator(".app-shell")).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await page.pdf({ path: testInfo.outputPath("responses-in-app-a4.pdf"), preferCSSPageSize: true, printBackground: true });
  const pdf = await standalone.pdf({ path: testInfo.outputPath("responses-a4-landscape.pdf"), preferCSSPageSize: true, printBackground: true });
  const mediaBoxes = [...pdf.toString("latin1").matchAll(/\/MediaBox\s*\[0 0 ([\d.]+) ([\d.]+)\]/g)];
  expect(mediaBoxes.length).toBeGreaterThanOrEqual(7);
  for (const box of mediaBoxes) {
    expect(Number(box[1])).toBeCloseTo(842, -1);
    expect(Number(box[2])).toBeCloseTo(595, -1);
  }
  await standalone.close();
  expect(pageErrors).toEqual([]);
});
