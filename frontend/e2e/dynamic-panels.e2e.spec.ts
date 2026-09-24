import { expect, test, type Download } from "@playwright/test";
import ExcelJS from "exceljs";
import { openSurveyApp } from "./fixtures/surveyApp";

async function bytes(download: Download) {
  const chunks: Buffer[] = [];
  for await (const chunk of (await download.createReadStream())!) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

test("dynamic panel records stay readable in answers, XLSX, HTML, print and statistics", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const { formId, pageErrors } = await openSurveyApp(page, { responseCount: 1, responseData: [{
    people: [
      { employee: "Даня", phone: "+7(111)-111-11-11", role: "teacher" },
      { employee: "Артём", phone: "+7(222)-222-22-22", role: "teacher" },
      { employee: "Женя", phone: "+7(333)-333-33-33", role: "admin" },
    ],
    note: "Проверено",
  }], pages: [{ title: "Сведения", elements: [
    { type: "panel", name: "staff", title: "Кадры", elements: [
      { type: "paneldynamic", name: "people", title: "Сотрудники", templateElements: [
        { type: "text", name: "employee", title: "Имя" },
        { type: "phone", name: "phone", title: "Телефон" },
        { type: "dropdown", name: "role", title: "Должность", choices: [{ value: "teacher", text: "Учитель" }, { value: "admin", text: "Администратор" }] },
      ] },
    ] },
    { type: "text", name: "note", title: "Примечание" },
  ] }] });
  const expected = "Запись 1\nИмя: Даня\nТелефон: +7(111)-111-11-11\nДолжность: Учитель\n\nЗапись 2\nИмя: Артём\nТелефон: +7(222)-222-22-22\nДолжность: Учитель\n\nЗапись 3\nИмя: Женя\nТелефон: +7(333)-333-33-33\nДолжность: Администратор";
  await page.goto(`/dashboard/forms/${formId}/responses`);
  const cell = page.locator(".responses-table td.responses-table-multiline-column");
  await expect(cell).toHaveText(expected);
  await expect(cell).toHaveCSS("white-space", "pre-wrap");
  expect((await cell.boundingBox())!.height).toBeGreaterThan(200);
  await expect(page.locator(".responses-table th")).toHaveText(["", "Дата ответа", "Сведения", "Кадры", "Сотрудники", "Примечание"]);
  await page.screenshot({ path: testInfo.outputPath("dynamic-panel-answers.png"), fullPage: true });
  const xlsxDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Скачать XLSX", exact: true }).click();
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await bytes(await xlsxDownload));
  const sheet = workbook.worksheets[0];
  expect(sheet.getCell("B4").text).toBe(expected);
  expect(sheet.getCell("B4").alignment.wrapText).toBe(true);
  expect(sheet.getRow(4).height).toBeGreaterThan(180);
  expect(sheet.getCell("C2").text).toBe("");
  expect(sheet.getCell("C4").text).toBe("Проверено");
  await page.getByRole("button", { name: "Отчёт", exact: true }).click();
  const report = page.getByRole("dialog", { name: "Отчёт по ответам" });
  await expect(report.locator(".response-report-question-path")).toHaveText(["Сведения / Кадры / Сотрудники", "Сведения / Кадры / Сотрудники", "Сведения / Кадры / Сотрудники", "Сведения"]);
  await expect(report).toContainText("Даня");
  await report.getByRole("button", { name: "Закрыть", exact: true }).click();
  await page.goto(`/dashboard/forms/${formId}/responses/html`);
  const htmlCell = page.locator(".responses-report-screen td.responses-table-multiline-column");
  await expect(htmlCell).toHaveText(expected);
  await expect(htmlCell).toHaveCSS("white-space", "pre-wrap");
  const htmlDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Скачать HTML", exact: true }).click();
  const html = (await bytes(await htmlDownload)).toString("utf8");
  expect(html).toContain(expected);
  expect(html).not.toContain('&quot;employee&quot;');
  await page.emulateMedia({ media: "print" });
  await expect(page.locator(".responses-report-print td.responses-table-multiline-column")).toHaveText(expected);
  await expect(page.locator(".responses-report-print td.responses-table-multiline-column")).toHaveCSS("white-space", "pre-wrap");
  expect(pageErrors).toEqual([]);
});
