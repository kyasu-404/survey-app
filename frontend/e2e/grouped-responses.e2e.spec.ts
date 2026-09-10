import { expect, test } from "@playwright/test";
import ExcelJS from "exceljs";
import { openSurveyApp } from "./fixtures/surveyApp";

test("page and section titles stay distinct in responses, HTML, and bordered Excel headers without merged cells", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  const questionPairs = Array.from({ length: 16 }, (_, index) => [
    { type: "text", name: `question${index + 1}`, title: `Пункт ${index + 1}` },
    { type: "comment", name: `comment${index + 1}`, title: "Комментарий" },
  ]).flat();
  const { formId, pageErrors } = await openSurveyApp(page, { responseCount: 2, pages: [
    { title: "Страница", elements: [
      { type: "sectiontitle", name: "s1", title: "Раздел" },
      { type: "text", name: "name", title: "Имя" },
      ...questionPairs.slice(0, 2),
    ] },
    { title: "Страница", elements: [
      { type: "sectiontitle", name: "s2", title: "Раздел" },
      ...questionPairs.slice(2),
    ] },
  ] });
  await page.goto(`/dashboard/forms/${formId}/responses`);
  await expect(page.getByText("Ответов: 2", { exact: true })).toBeVisible();
  const expectedHeaders = ["Дата ответа", "Страница", "Раздел", "Имя", "Пункт 1", "Комментарий", "Страница", "Раздел", ...questionPairs.slice(2).map(q => q.title)];
  await expect(page.locator(".responses-table th")).toHaveText(["", ...expectedHeaders]);
  await expect(page.locator("th.responses-table-page-column")).toHaveCount(2);
  await expect(page.locator("th.responses-table-section-column")).toHaveCount(2);
  await expect(page.locator("th.responses-table-page-column").first()).toHaveCSS("background-color", "rgb(219, 234, 254)");
  await expect(page.locator("th.responses-table-section-column").first()).toHaveCSS("font-weight", "800");
  await expect(page.locator("td.responses-table-page-column, td.responses-table-section-column")).toHaveText(Array(8).fill(""));
  await page.screenshot({ path: testInfo.outputPath("grouped-responses.png"), fullPage: true });

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Скачать XLSX" }).click();
  const download = await downloadPromise;
  const chunks: Buffer[] = [];
  for await (const chunk of (await download.createReadStream())!) chunks.push(Buffer.from(chunk));
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Buffer.concat(chunks));
  const sheet = workbook.worksheets[0];
  expect(sheet.model.merges).toEqual([]);
  expect(sheet.getCell("B1").text).toBe("Страница");
  expect(sheet.getCell("E1").text).toBe("Страница");
  expect(sheet.getCell("B2").text).toBe("Раздел");
  expect(sheet.getCell("E2").text).toBe("Раздел");
  expect(sheet.getCell("C1").text).toBe("");
  expect(sheet.getCell("C2").text).toBe("");
  expect(sheet.getCell("E5").border.left?.style).toBe("medium");
  expect(sheet.getCell("F5").border.left?.style).toBe("thin");
  expect(sheet.getCell("AH5").border.bottom?.style).toBe("thin");
  expect((sheet.getRow(3).values as unknown[]).slice(1)).toEqual(["Дата ответа", "Имя", ...questionPairs.map(q => q.title)]);
  expect(sheet.getCell("B4").text).toBe("Ответ 1");
  expect(sheet.getCell("D4").text).toBe("Комментарий 1, ответ 1");
  expect(sheet.getCell("F5").text).toBe("Комментарий 2, ответ 2");
  expect(sheet.getCell("AH5").text).toBe("");
  expect(sheet.getCell("B1").fill).toMatchObject({ fgColor: { argb: "FFDBEAFE" } });
  expect(sheet.getCell("B2").font.bold).toBe(true);
  expect(sheet.rowCount).toBe(5);
  expect(sheet.columnCount).toBe(34);

  await page.getByRole("button", { name: /^Сменить тему/ }).click();
  await page.locator('[data-theme-option="graphite"]').click();
  await expect(page.locator("th.responses-table-page-column").first()).toHaveCSS("background-color", "rgb(30, 58, 95)");
  await page.screenshot({ path: testInfo.outputPath("grouped-responses-dark.png"), fullPage: true });
  await page.goto(`/dashboard/forms/${formId}/responses/html`);
  await expect(page.locator(".responses-report-screen th")).toHaveText(expectedHeaders);
  await expect(page.locator(".responses-report-screen th.responses-table-page-column").first()).toHaveCSS("background-color", "rgb(30, 58, 95)");
  await expect(page.locator(".responses-report-screen th.responses-table-section-column").first()).toHaveCSS("font-weight", "800");
  const htmlDownloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Скачать HTML" }).click();
  const htmlChunks: Buffer[] = [];
  for await (const chunk of (await (await htmlDownloadPromise).createReadStream())!) htmlChunks.push(Buffer.from(chunk));
  const html = Buffer.concat(htmlChunks).toString("utf8");
  expect(html.match(/<th class="responses-table-page-column">Страница<\/th>/g)).toHaveLength(2);
  expect(html.match(/<th class="responses-table-section-column">Раздел<\/th>/g)).toHaveLength(2);
  expect(html.match(/<td class="responses-table-(page|section)-column"><\/td>/g)).toHaveLength(8);
  expect(pageErrors).toEqual([]);
});
