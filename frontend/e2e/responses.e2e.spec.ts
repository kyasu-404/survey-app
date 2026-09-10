import { expect, test } from "@playwright/test";
import ExcelJS from "exceljs";
import { openSurveyApp } from "./fixtures/surveyApp";

test("200 loaded form cards refresh with one keyset request", async ({ page }) => {
  const { listRequests, pageErrors } = await openSurveyApp(page);
  await expect(page.getByText("Карточка 20", { exact: true })).toBeVisible();
  for (let count = 40; count <= 200; count += 20) {
    await page.getByRole("button", { name: "Показать ещё", exact: true }).click();
    await expect(page.getByText(`Карточка ${count}`, { exact: true })).toBeVisible();
  }
  expect(listRequests).toHaveLength(10);
  listRequests.length = 0;
  await page.getByRole("button", { name: "Обновить", exact: true }).click();
  await expect.poll(() => listRequests.length).toBe(1);
  expect(listRequests[0]).toEqual({ cursor: null, limit: 201 });
  await expect(page.getByText("Карточка 200", { exact: true })).toBeVisible();
  expect(pageErrors).toEqual([]);
});

test("200 answers preserve 16 duplicated comments in the table, XLSX, HTML, and report, and delete in batches", async ({ page }, testInfo) => {
  const { formId, questions, commentTitle, deletedBatchSizes, pageErrors } = await openSurveyApp(page);
  await page.goto(`/dashboard/forms/${formId}/responses`);
  await expect(page.getByText("Ответов: 200", { exact: true })).toBeVisible();
  const expectedHeaders = ["Дата ответа", "Имя", ...questions.map((question) => question.title)];
  await expect(page.getByRole("columnheader", { name: commentTitle, exact: true })).toHaveCount(16);
  await expect(page.locator(".responses-table th")).toHaveText(["", ...expectedHeaders]);
  const firstCells = page.locator(".responses-table tbody tr").first().locator("td");
  for (let index = 0; index < 16; index += 1) {
    await expect(firstCells.nth(4 + 2 * index)).toHaveText(index === 15 ? "" : `Комментарий ${index + 1}, ответ 1`);
  }
  await expect(page.getByLabel("Страницы ответов")).toHaveCount(0);
  const table = page.locator(".responses-page-table-shell");
  expect(await table.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);
  await table.evaluate((element) => { element.scrollTop = element.scrollHeight; });
  await expect(page.getByRole("cell", { name: "Ответ 200", exact: true })).toBeInViewport();
  await page.screenshot({ path: testInfo.outputPath("responses-200.png"), fullPage: true });
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Скачать XLSX" }).click();
  const download = await downloadPromise;
  const workbook = new ExcelJS.Workbook();
  const chunks: Buffer[] = [];
  const stream = await download.createReadStream();
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
  await workbook.xlsx.load(Buffer.concat(chunks));
  const sheet = workbook.worksheets[0];
  expect(sheet.rowCount).toBe(201);
  expect(sheet.columnCount).toBe(expectedHeaders.length);
  expect((sheet.getRow(1).values as unknown[]).slice(1)).toEqual(expectedHeaders);
  for (let index = 0; index < 16; index += 1) {
    expect(sheet.getRow(2).getCell(4 + 2 * index).text).toBe(index === 15 ? "" : `Комментарий ${index + 1}, ответ 1`);
    expect(sheet.getRow(201).getCell(4 + 2 * index).text).toBe(index === 15 ? "" : `Комментарий ${index + 1}, ответ 200`);
  }
  const values = sheet.getSheetValues().flat(2);
  expect(values).toContain("Ответ 1");
  expect(values).toContain("Ответ 200");
  await page.getByRole("button", { name: "Отчёт", exact: true }).click();
  const report = page.getByRole("dialog", { name: "Отчёт по ответам" });
  await expect(report.locator(".response-report-summary strong").first()).toHaveText("200");
  await expect(report.getByText(commentTitle, { exact: true })).toHaveCount(16);
  await report.getByRole("button", { name: "Закрыть", exact: true }).click();
  await page.goto(`/dashboard/forms/${formId}/responses/html`);
  await expect(page.getByText("Ответ 200", { exact: true })).toBeVisible();
  await expect(page.locator(".responses-html-preview th")).toHaveText(expectedHeaders);
  const htmlDownloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Скачать HTML" }).click();
  const htmlDownload = await htmlDownloadPromise;
  const htmlChunks: Buffer[] = [];
  const htmlStream = await htmlDownload.createReadStream();
  for await (const chunk of htmlStream!) htmlChunks.push(Buffer.from(chunk));
  const html = Buffer.concat(htmlChunks).toString("utf8");
  const downloadedTable = await page.evaluate((source) => {
    const document = new DOMParser().parseFromString(source, "text/html");
    return {
      headers: Array.from(document.querySelectorAll("th"), (cell) => cell.textContent),
      firstRow: Array.from(document.querySelectorAll("tbody tr:first-child td"), (cell) => cell.textContent),
    };
  }, html);
  expect(downloadedTable.headers).toEqual(expectedHeaders);
  for (let index = 0; index < 16; index += 1) {
    expect(downloadedTable.firstRow[3 + 2 * index]).toBe(index === 15 ? "" : `Комментарий ${index + 1}, ответ 1`);
  }
  await page.goto(`/dashboard/forms/${formId}/responses`);
  await expect(page.getByText("Ответов: 200", { exact: true })).toBeVisible();
  await page.getByRole("checkbox", { name: "Выбрать все ответы", exact: true }).check();
  await expect(page.getByText("Выбрано: 200")).toBeVisible();
  page.on("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Удалить", exact: true }).click();
  await expect(page.getByText("Ответов пока нет", { exact: true })).toBeVisible();
  expect(deletedBatchSizes).toEqual([100, 100]);
  expect(pageErrors).toEqual([]);
});
