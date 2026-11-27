import { expect, test } from "@playwright/test";
import ExcelJS from "exceljs";
import { openSurveyApp } from "./fixtures/surveyApp";

test("200 loaded form cards refresh with one keyset request", async ({ page }) => {
  const { listRequests, pageErrors, realtime, form } = await openSurveyApp(page);
  const initialRequests = listRequests.length;
  await expect(page.getByText("Карточка 20", { exact: true })).toBeVisible();
  for (let count = 40; count <= 200; count += 20) {
    await page.getByRole("button", { name: "Показать ещё", exact: true }).click();
    await expect(page.getByText(`Карточка ${count}`, { exact: true })).toBeVisible();
  }
  expect(listRequests).toHaveLength(initialRequests + 9);
  listRequests.length = 0;
  realtime.change("forms", "INSERT", form);
  await expect.poll(() => listRequests.length).toBe(1);
  expect(listRequests[0]).toEqual({ cursor: null, limit: 201 });
  await expect(page.getByText("Карточка 200", { exact: true })).toBeVisible();
  expect(pageErrors).toEqual([]);
});

test("sorts responses across cursor batches and shows sort controls in both themes", async ({ page }, testInfo) => {
  const responseData = Array.from({ length: 105 }, (_, i) => ({ name: `Строка ${i + 1}`, score: i === 0 ? 10 : i === 104 ? 2 : undefined }));
  const { formId, pageErrors } = await openSurveyApp(page, {
    responseCount: responseData.length,
    responseData,
    elements: [{ type: "text", name: "name", title: "Имя" }, { type: "text", inputType: "number", name: "score", title: "Баллы" }],
  });
  const navigation = page.getByRole("navigation", { name: "Основная навигация" });
  const allForms = navigation.getByRole("link", { name: "Все формы", exact: true });
  await allForms.click();
  await expect(allForms).toHaveAttribute("aria-current", "page");
  await expect(allForms).toHaveCSS("background-color", "color(srgb 0.932078 0.852078 0.805412)");
  await expect(navigation.getByRole("link", { name: "Мои формы", exact: true })).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await navigation.screenshot({ path: testInfo.outputPath("active-navigation-light.png") });

  await page.goto(`/dashboard/forms/${formId}/responses`);
  const table = page.locator(".responses-page-table-shell");
  const header = table.getByRole("columnheader", { name: "Баллы" });
  const rows = table.locator("tbody tr");
  const icon = header.locator(".responses-sort-icon");
  await expect(rows.first().getByText("Строка 1", { exact: true })).toBeVisible();
  await expect(icon).toHaveAttribute("data-icon", "unfold_more");
  await expect(icon).toHaveCSS("font-size", "16px");
  await expect(icon).toHaveCSS("color", "rgb(95, 86, 76)");

  // A click in the header padding also triggers its button.
  await header.click({ position: { x: 3, y: 45 } });
  await expect(header).toHaveAttribute("aria-sort", "ascending");
  await expect(rows.first().getByText("Строка 105", { exact: true })).toBeVisible();
  await expect(icon).toHaveAttribute("data-icon", "expand_less");
  await expect(icon).toHaveCSS("color", "rgb(170, 65, 39)");
  await table.screenshot({ path: testInfo.outputPath("response-sort-light.png") });

  await page.locator(".sidebar-account-trigger").click();
  await page.locator('[data-theme-option="graphite"]').click();
  await page.keyboard.press("Escape");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "graphite");
  const sortButton = header.getByRole("button");
  await sortButton.focus();
  await page.keyboard.press("Enter");
  await expect(header).toHaveAttribute("aria-sort", "descending");
  await expect(icon).toHaveAttribute("data-icon", "expand_more");
  await expect(icon).toHaveCSS("font-size", "16px");
  await expect(icon).toHaveCSS("color", "rgb(168, 199, 250)");
  await expect(rows.first().getByText("Строка 1", { exact: true })).toBeVisible();
  await table.screenshot({ path: testInfo.outputPath("response-sort-dark.png") });

  await sortButton.click();
  await expect(header).not.toHaveAttribute("aria-sort");
  await expect(icon).toHaveAttribute("data-icon", "unfold_more");
  await expect(icon).toHaveCSS("color", "rgb(196, 199, 197)");
  await expect(rows.nth(1).getByText("Строка 2", { exact: true })).toBeVisible();
  expect(pageErrors).toEqual([]);
});

test("keeps a single table outline and rounded selection controls", async ({ page }, testInfo) => {
  const { formId } = await openSurveyApp(page, {
    responseCount: 2,
    responseData: [{ name: "Анна", score: 2 }, { name: "Борис", score: 10 }],
    elements: [{ type: "text", name: "name", title: "Имя" }, { type: "text", inputType: "number", name: "score", title: "Баллы" }],
  });
  await page.goto(`/dashboard/forms/${formId}/responses`);
  const shell = page.locator(".responses-page-table-shell");
  const table = shell.getByRole("table");
  const headerCheckbox = table.getByRole("checkbox", { name: "Выбрать ответы на странице" });
  const rowCheckbox = table.getByRole("checkbox", { name: "Выбрать Ответ Анна" });

  await expect(table).toHaveCSS("border-collapse", "separate");
  await expect(shell).toHaveCSS("border-top-width", "1px");
  const headers = table.getByRole("columnheader");
  await expect(headers.first()).toHaveCSS("border-left-width", "0px");
  await expect(headers.last()).toHaveCSS("border-right-width", "0px");
  await expect(headers.last()).toHaveCSS("border-top-width", "0px");
  await expect(headers.last()).toHaveCSS("border-bottom-width", "1px");
  await expect(table.getByRole("cell").last()).toHaveCSS("border-bottom-width", "0px");
  await expect(headerCheckbox).toHaveCSS("border-radius", "5px");
  await expect(rowCheckbox).toHaveCSS("border-radius", "5px");
  await expect(rowCheckbox).toHaveCSS("width", "18px");
  await expect(rowCheckbox).toHaveCSS("height", "18px");

  await rowCheckbox.focus();
  await page.keyboard.press("Space");
  await expect(rowCheckbox).toBeChecked();
  await expect(headerCheckbox).toHaveJSProperty("indeterminate", true);
  await shell.screenshot({ path: testInfo.outputPath("response-table-edges-light.png") });

  await page.locator(".sidebar-account-trigger").click();
  await page.locator('[data-theme-option="graphite"]').click();
  await page.keyboard.press("Escape");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "graphite");
  await expect(headerCheckbox).toHaveCSS("border-radius", "5px");
  await expect(headerCheckbox).toHaveJSProperty("indeterminate", true);
  await shell.screenshot({ path: testInfo.outputPath("response-table-edges-dark.png") });

  await headerCheckbox.click();
  await expect(headerCheckbox).toBeChecked();
  await expect(headerCheckbox).toHaveJSProperty("indeterminate", false);
  await expect(table.getByRole("checkbox", { name: "Выбрать Ответ Борис" })).toBeChecked();
});

test("200 answers preserve 16 duplicated comments in the table, XLSX, HTML, and report, and delete in batches", async ({ page }, testInfo) => {
  const { formId, questions, commentTitle, deletedBatchSizes, pageErrors } = await openSurveyApp(page);
  await page.goto(`/dashboard/forms/${formId}/responses`);
  await expect(page.getByText("Ответов: 200", { exact: true })).toBeVisible();
  const expectedHeaders = ["Дата ответа", "Имя", ...questions.map((question) => question.title)];
  await expect(page.getByRole("columnheader", { name: commentTitle, exact: true })).toHaveCount(16);
  const liveHeaders = page.locator(".responses-table").getByRole("columnheader");
  await expect(liveHeaders).toHaveCount(expectedHeaders.length + 1);
  for (const [index, name] of expectedHeaders.entries()) {
    await expect(liveHeaders.nth(index + 1)).toHaveAccessibleName(name);
  }
  const firstCells = page.locator(".responses-table tbody tr").first().locator("td");
  for (let index = 0; index < 16; index += 1) {
    await expect(firstCells.nth(4 + 2 * index)).toHaveText(index === 15 ? "" : `Комментарий ${index + 1}, ответ 1`);
  }
  await expect(page.getByLabel("Страницы ответов")).toBeVisible();
  await expect(page.locator(".responses-table tbody tr")).toHaveCount(50);
  for (let i = 0; i < 3; i++) {
    await page.getByRole("button", { name: "Далее", exact: true }).click();
    await expect(page.getByText(`Страница ${i + 2} из 4`)).toBeVisible();
  }
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
  await page.getByRole("button", { name: "HTML", exact: true }).click();
  await expect(page.locator(".responses-report-screen").getByText("Ответ 200", { exact: true })).toBeVisible();
  await expect(page.locator(".responses-report-screen th")).toHaveText(expectedHeaders);
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
      headers: Array.from(document.querySelectorAll(".responses-report-screen th"), (cell) => cell.textContent),
      firstRow: Array.from(document.querySelectorAll(".responses-report-screen tbody tr:first-child td"), (cell) => cell.textContent),
    };
  }, html);
  expect(downloadedTable.headers).toEqual(expectedHeaders);
  for (let index = 0; index < 16; index += 1) {
    expect(downloadedTable.firstRow[3 + 2 * index]).toBe(index === 15 ? "" : `Комментарий ${index + 1}, ответ 1`);
  }
  await page.getByRole("link", { name: "Назад к ответам", exact: true }).click();
  await expect(page).toHaveURL(`/dashboard/forms/${formId}/responses`);
  await expect(page.getByText("Ответов: 200", { exact: true })).toBeVisible();
  await page.getByRole("checkbox", { name: "Выбрать ответы на странице", exact: true }).check();
  await expect(page.getByText("Выбрано: 50")).toBeVisible();
  page.on("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Удалить", exact: true }).click();
  await expect(page.getByText("Ответов: 150", { exact: true })).toBeVisible();
  expect(deletedBatchSizes).toEqual([50]);
  expect(pageErrors).toEqual([]);
});
