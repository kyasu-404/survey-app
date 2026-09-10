import { expect, test } from "@playwright/test";
import ExcelJS from "exceljs";
import { openSurveyApp } from "./fixtures/surveyApp";

test("PNG, JPEG and SVG signatures render as thumbnails and export as embedded Excel and HTML images", async ({ page }, testInfo) => {
  await page.goto("/login");
  const signatures = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 320;
    canvas.height = 120;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, 320, 120);
    ctx.strokeStyle = "#111";
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(20, 70); ctx.bezierCurveTo(90, 5, 280, 100, 50, 90); ctx.lineTo(240, 30); ctx.stroke();
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="320" height="120" viewBox="0 0 320 120"><path d="M 20,70 C 90,5 280,100 50,90 L 240,30" stroke="#111" stroke-width="3" fill="none" stroke-linecap="round"/></svg>';
    return { png: canvas.toDataURL("image/png"), jpeg: canvas.toDataURL("image/jpeg"), svg: `data:image/svg+xml;base64,${btoa(svg)}` };
  });
  const { formId, pageErrors } = await openSurveyApp(page, { responseCount: 3, responseData: [
    { ...signatures, name: "Анна" }, { png: "data:image/png;base64,bad", name: "Борис" }, { name: "Вера" },
  ], pages: [{ title: "Страница", elements: [
    { type: "sectiontitle", name: "s", title: "Раздел" },
    ...["png", "jpeg", "svg"].map(name => ({ type: "signaturepad", name, title: "Подпись" })),
    { type: "text", name: "name", title: "Имя" },
  ] }] });
  await page.goto(`/dashboard/forms/${formId}/responses`);
  await expect(page.getByText("Ответов: 3", { exact: true })).toBeVisible();
  const images = page.locator(".responses-table img.response-signature-image");
  await expect(images).toHaveCount(3);
  for (const image of await images.all()) {
    await expect(image).toBeVisible();
    await expect.poll(() => image.evaluate(node => (node as HTMLImageElement).naturalWidth)).toBe(320);
    await expect(image).toHaveCSS("object-fit", "contain");
  }
  await expect(page.locator(".responses-table")).not.toContainText("base64");
  await expect(page.getByText("Не удалось отобразить подпись", { exact: true })).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Открыть Ответ Анна", exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("signature-thumbnails.png"), fullPage: true });

  const xlsxDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Скачать XLSX" }).click();
  const xlsxChunks: Buffer[] = [];
  for await (const chunk of (await (await xlsxDownload).createReadStream())!) xlsxChunks.push(Buffer.from(chunk));
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Buffer.concat(xlsxChunks));
  const sheet = workbook.worksheets[0];
  const drawings = sheet.getImages();
  expect(drawings).toHaveLength(3);
  expect(drawings.map(image => [image.range.tl.nativeCol, image.range.tl.nativeRow])).toEqual([[1, 3], [2, 3], [3, 3]]);
  expect(drawings.map(image => workbook.getImage(Number(image.imageId)).extension)).toEqual(["png", "jpeg", "png"]);
  expect(sheet.getRow(4).height).toBe(78);
  expect(["B4", "C4", "D4"].map(cell => sheet.getCell(cell).text)).toEqual(["", "", ""]);
  expect(sheet.getCell("B5").text).toBe("Не удалось отобразить подпись");
  expect(sheet.getCell("E6").text).toBe("Вера");

  await page.goto(`/dashboard/forms/${formId}/responses/html`);
  await expect(page.locator(".responses-report-screen img")).toHaveCount(3);
  const htmlDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Скачать HTML" }).click();
  const htmlChunks: Buffer[] = [];
  for await (const chunk of (await (await htmlDownload).createReadStream())!) htmlChunks.push(Buffer.from(chunk));
  const standalone = await page.context().newPage();
  await standalone.setContent(Buffer.concat(htmlChunks).toString("utf8"));
  await expect(standalone.locator(".responses-report-print")).toBeHidden();
  await expect(standalone.locator(".responses-report-screen img")).toHaveCount(3);
  await standalone.emulateMedia({ media: "print" });
  await expect(standalone.locator(".responses-report-screen")).toBeHidden();
  for (const image of await standalone.locator(".responses-report-print img").all()) {
    await expect(image).toBeVisible();
    await expect.poll(() => image.evaluate(node => (node as HTMLImageElement).naturalWidth)).toBe(320);
  }
  expect(await standalone.locator("body").innerText()).not.toContain("base64");
  await standalone.screenshot({ path: testInfo.outputPath("signatures-print.png"), fullPage: true });
  await standalone.close();
  expect(pageErrors).toEqual([]);
});
