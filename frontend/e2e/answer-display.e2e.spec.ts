import { expect, test } from "@playwright/test";
import ExcelJS from "exceljs";
import { openSurveyApp } from "./fixtures/surveyApp";

test("Other text, matrix labels and smiley colors agree in answers and readonly preview", async ({ page }, testInfo) => {
  const { formId, pageErrors } = await openSurveyApp(page, { responseCount: 1, responseData: [{ name: "Анна", choice: "other", "choice-Comment": "Свой вариант", matrix: { r2: "a", r3: "b" }, rating: 4 }], elements: [
    { type: "text", name: "name", title: "Имя" },
    { type: "dropdown", name: "choice", title: "Выбор", ...{ showOtherItem: true, choices: ["Первый"] } },
    { type: "matrix", name: "matrix", title: "Матрица", ...{ rows: [{ value: "r2", text: "Вторая строка" }, { value: "r3", text: "Третья строка" }], columns: [{ value: "a", text: "Согласен" }, { value: "b", text: "Не согласен" }] } },
    { type: "rating", name: "rating", title: "Рейтинг", ...{ rateType: "smileys" } },
  ] });
  await page.goto(`/dashboard/forms/${formId}/responses`);
  const table = page.locator(".responses-table");
  await expect(table).toContainText("Свой вариант");
  await expect(table).not.toContainText("other");
  await expect(table).not.toContainText("-Comment");
  await expect(table.locator("td.responses-table-multiline-column")).toHaveText("Вторая строка: Согласен\nТретья строка: Не согласен");
  const downloaded = page.waitForEvent("download");
  await page.getByRole("button", { name: "Скачать XLSX", exact: true }).click();
  const chunks: Buffer[] = [];
  for await (const chunk of (await (await downloaded).createReadStream())!) chunks.push(Buffer.from(chunk));
  const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(Buffer.concat(chunks));
  expect(workbook.worksheets[0].getCell("C2").text).toBe("Свой вариант");
  expect(workbook.worksheets[0].getCell("D2").text).toBe("Вторая строка: Согласен\nТретья строка: Не согласен");
  await page.getByRole("button", { name: "Открыть Ответ Анна", exact: true }).click();
  const selected = page.locator(".response-preview-drawer .sd-rating__item-smiley--selected");
  await expect(selected).toBeVisible();
  const color = await selected.evaluate(el => getComputedStyle(el).backgroundColor);
  expect(color).not.toMatch(/rgba?\((?:0, 0, 0|18, 18, 18|24, 24, 24)/);
  await expect(selected).toHaveCSS("fill", "rgb(255, 255, 255)");
  await page.screenshot({ path: testInfo.outputPath("answer-preview.png"), fullPage: true });
  await page.goto(`/form/${formId}`);
  const smiley = page.locator(".sd-rating__item-smiley").nth(3);
  await smiley.click(); await page.mouse.move(0, 0);
  await expect(smiley).toHaveCSS("background-color", color);
  await expect(page.locator(".sd-root-modern")).toHaveCSS("--sjs-general-backcolor-dim", "#eae4dc");
  await page.goto(`/dashboard/forms/${formId}/responses/html`);
  await expect(page.locator(".responses-report-screen")).toContainText("Свой вариант");
  await expect(page.locator(".responses-report-screen td.responses-table-multiline-column")).toHaveCSS("white-space", "pre-wrap");
  expect(pageErrors).toEqual([]);
});

test("server validation errors preserve the draft and identify the cause", async ({ page }) => {
  const { formId } = await openSurveyApp(page, { responseCount: 0, elements: [{ type: "text", name: "name", title: "Имя" }] });
  await page.route("**/rest/v1/rpc/submit_form_response", route => route.fulfill({ status: 400, json: { code: "22023", message: "Срок загрузки файла истёк. Прикрепите файл заново." } }));
  await page.goto(`/form/${formId}`);
  await page.getByRole("textbox", { name: "Имя", exact: true }).fill("Анна");
  await page.getByRole("button", { name: "Отправить", exact: true }).click();
  await expect(page.getByText("Ошибка отправки: Срок загрузки файла истёк. Прикрепите файл заново.", { exact: true })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Имя", exact: true })).toHaveValue("Анна");
  await page.reload();
  await expect(page.getByRole("textbox", { name: "Имя", exact: true })).toHaveValue("Анна");
});
