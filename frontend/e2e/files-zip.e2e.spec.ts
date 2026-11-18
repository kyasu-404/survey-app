import { expect, test, type Download } from "@playwright/test";
import JSZip from "jszip";
import { openSurveyApp } from "./fixtures/surveyApp";

async function readZip(download: Download) {
  const chunks: Buffer[] = [];
  for await (const chunk of (await download.createReadStream())!) chunks.push(Buffer.from(chunk));
  return JSZip.loadAsync(Buffer.concat(chunks));
}

test("ZIP matches XLSX styling and contains every attachment, including answers beyond the first API page", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  const formId = "20000000-0000-4000-8000-000000000001";
  const file = (id: string) => ({ name: "Документ.pdf", content: `public/${formId}/${id}.pdf`, type: "application/pdf" });
  const legacy = { name: "Документ.pdf", content: "data:application/pdf;base64,AAEC/w==", type: "application/pdf" };
  const responseData: Array<Record<string, unknown>> = Array.from({ length: 101 }, () => ({}));
  responseData[0] = { files: [file("one"), file("two")] };
  responseData[100] = { people: [{ proof: [file("three")] }], legacy: [legacy], unrelated: file("ignore") };
  const { pageErrors } = await openSurveyApp(page, { responseCount: 101, responseData, pages: [{ elements: [
    { type: "file", name: "files", title: "Документы" },
    { type: "paneldynamic", name: "people", templateElements: [{ type: "file", name: "proof", title: "Документы" }] },
    { type: "panel", name: "panel", elements: [{ type: "file", name: "legacy", title: "Документы" }] },
    { type: "text", name: "unrelated" },
  ] }] });
  const signedPaths: string[] = [];
  await page.route("**/storage/v1/object/sign/**", async route => {
    const path = new URL(route.request().url()).pathname;
    if (route.request().method() === "POST") {
      signedPaths.push(path);
      return route.fulfill({ json: { signedURL: `${path.replace("/storage/v1", "")}?token=fresh` } });
    }
    expect(new URL(route.request().url()).searchParams.get("token")).toBe("fresh");
    return route.fulfill({ contentType: "application/pdf", body: Buffer.from(`Original bytes: ${path.split("/").pop()}`) });
  });
  await page.goto(`/dashboard/forms/${formId}/responses`);
  await expect(page.getByText("Ответов: 101", { exact: true })).toBeVisible();
  const xlsx = page.getByRole("button", { name: "Скачать XLSX", exact: true });
  const zipButton = page.getByRole("button", { name: "Файлы в ZIP", exact: true });
  await expect(zipButton).toBeVisible();
  expect(await zipButton.getAttribute("class")).toBe(await xlsx.getAttribute("class"));
  const zipIcon = zipButton.locator('[data-icon="download"]');
  const xlsxIcon = xlsx.locator('[data-icon="download"]');
  await expect(zipIcon).toBeVisible();
  await expect(xlsxIcon).toBeVisible();
  await expect(zipIcon).toHaveAttribute("aria-hidden", "true");
  expect(await zipIcon.textContent()).toBe(await xlsxIcon.textContent());
  expect(await zipIcon.evaluate(el => getComputedStyle(el).fontFamily)).toContain("Material Symbols Outlined");
  const getColors = (element: HTMLElement | SVGElement) => {
    const style = getComputedStyle(element);
    return [style.color, style.backgroundColor];
  };
  expect(await zipButton.evaluate(getColors)).toEqual(await xlsx.evaluate(getColors));
  const xlsxBox = (await xlsx.boundingBox())!;
  const zipBox = (await zipButton.boundingBox())!;
  expect(zipBox.y).toBe(xlsxBox.y);
  expect(zipBox.x).toBeGreaterThanOrEqual(xlsxBox.x + xlsxBox.width);

  await page.screenshot({ path: testInfo.outputPath("files-zip-button.png") });
  const pending = page.waitForEvent("download");
  await zipButton.click();
  const download = await pending;
  expect(download.suggestedFilename()).toBe("Файлы-Проверка полного списка.zip");
  const zip = await readZip(download);
  const entries = Object.values(zip.files);
  expect(entries).toHaveLength(4);
  expect(entries.every(entry => entry.name.endsWith("Документ.pdf"))).toBe(true);
  expect(Object.keys(zip.files).sort()).toEqual([
    "Ответ — 001/1_Документы/1_Документ.pdf",
    "Ответ — 001/1_Документы/2_Документ.pdf",
    "Ответ — 101/2_Документы/1_Документ.pdf",
    "Ответ — 101/3_Документы/1_Документ.pdf",
  ]);
  const contents = await Promise.all(entries.map(entry => entry.async("nodebuffer")));
  expect(contents.map(content => content.toString("base64")).sort()).toEqual([
    ...["one", "two", "three"].map(id => Buffer.from(`Original bytes: ${id}.pdf`).toString("base64")),
    "AAEC/w==",
  ].sort());
  expect(signedPaths).toHaveLength(3);
  await expect(page.getByText("Файлы выгружены в ZIP: 4", { exact: true })).toBeVisible();
  await expect(zipButton).toBeEnabled();

  await page.getByRole("button", { name: "Далее", exact: true }).click();
  await page.getByRole("button", { name: "Далее", exact: true }).click();
  await expect(page.getByText("Страница 3 из 3", { exact: true })).toBeVisible();
  await page.getByRole("checkbox", { name: "Выбрать ответы на странице" }).check();
  const selectedDownload = page.waitForEvent("download");
  await zipButton.click();
  const selectedZip = await readZip(await selectedDownload);
  expect(Object.keys(selectedZip.files).sort()).toEqual([
    "Ответ — 101/2_Документы/1_Документ.pdf",
    "Ответ — 101/3_Документы/1_Документ.pdf",
  ]);
  expect(pageErrors).toEqual([]);
});

test("ZIP uses a nested organization, reports a missing attachment and permits a complete retry", async ({ page }) => {
  const formId = "20000000-0000-4000-8000-000000000001";
  const organizationId = "40000000-0000-4000-8000-000000000001";
  const schoolsQuestion = {
    type: "matrixdynamic",
    name: "schools",
    detailElements: [{ type: "organization", name: "school", title: "Организация" }],
  };
  const { pageErrors } = await openSurveyApp(page, { responseCount: 1, responseData: [{ schools: [{ school: organizationId }], files: [
    { name: "available.txt", content: `public/${formId}/available.txt` },
    { name: "missing.txt", content: `public/${formId}/missing.txt` },
  ] }], elements: [
    schoolsQuestion,
    { type: "file", name: "files", title: "Файлы" },
  ] });
  await page.route("**/rest/v1/education_organizations?*", route => route.fulfill({ json: [{
    id: organizationId, organization_type: "school", number: "373", alias: "ГБОУ", email: "school@example.test",
    is_archived: true, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z",
  }] }));
  let missing = true;
  await page.route("**/storage/v1/object/sign/**", async route => {
    const path = new URL(route.request().url()).pathname;
    if (route.request().method() === "POST") {
      return route.fulfill({ json: { signedURL: `${path.replace("/storage/v1", "")}?token=fresh` } });
    }
    return missing && path.endsWith("missing.txt")
      ? route.fulfill({ status: 404, body: "Missing" })
      : route.fulfill({ contentType: "text/plain", body: "File content" });
  });
  await page.goto(`/dashboard/forms/${formId}/responses`);
  const button = page.getByRole("button", { name: "Файлы в ZIP", exact: true });
  let pending = page.waitForEvent("download");
  await button.click();
  const partial = await readZip(await pending);
  expect(Object.keys(partial.files)).toHaveLength(2);
  expect(await partial.file("Не удалось скачать.txt")!.async("string")).toContain("ГБОУ 373 — 001/2_missing.txt");
  await expect(page.getByText("В ZIP добавлено файлов: 1. Не удалось скачать: 1. Список включён в архив.", { exact: true })).toBeVisible();
  await expect(button).toBeEnabled();
  missing = false;
  pending = page.waitForEvent("download");
  await button.click();
  const complete = await readZip(await pending);
  expect(Object.keys(complete.files).sort()).toEqual([
    "ГБОУ 373 — 001/1_available.txt",
    "ГБОУ 373 — 001/2_missing.txt",
  ]);
  expect(complete.file("Не удалось скачать.txt")).toBeNull();
  expect(await Promise.all(Object.values(complete.files).map(file => file.async("string")))).toEqual(["File content", "File content"]);
  await expect(page.getByText("Файлы выгружены в ZIP: 2", { exact: true })).toBeVisible();
  expect(pageErrors).toEqual([]);
});
