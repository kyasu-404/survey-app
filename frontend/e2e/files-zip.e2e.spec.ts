import { once } from "node:events";
import { createServer, request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { expect, test as base, type Download } from "@playwright/test";
import JSZip from "jszip";
import { createArchiveFixture } from "../../office-service/test/fixtures/response-archive.mjs";
import { openSurveyApp } from "./fixtures/surveyApp";

type ZipOrigin = {
  url: string;
  connect: (options: Parameters<typeof createArchiveFixture>[1]) => ReturnType<typeof createArchiveFixture>;
  downloads: Array<{ hasCookie: boolean; hasAuthorization: boolean }>;
};

const test = base.extend<{ zipOrigin: ZipOrigin }>({
  zipOrigin: async ({ baseURL }, use) => {
    if (!baseURL) throw new Error("Expected a frontend test server");
    const cleanup: Array<() => Promise<void>> = [];
    const downloads: ZipOrigin["downloads"] = [];
    let apiOrigin: string | undefined;
    // Browser-managed downloads bypass Playwright request interception. Forward
    // both endpoints over the same HTTP origin as the Vite frontend.
    const proxy = createServer((req, res) => {
      const path = req.url ?? "/";
      const archive = /^\/api\/office\/(?:forms\/[^/]+\/response-archive|response-archives\/[^/]+)$/.test(path);
      if (archive && !apiOrigin) return res.writeHead(503).end();
      if (archive && req.method === "GET") {
        downloads.push({ hasCookie: Boolean(req.headers.cookie?.includes("survey_response_zip=")), hasAuthorization: Boolean(req.headers.authorization) });
      }
      const url = new URL(path, archive ? apiOrigin : baseURL);
      const request = url.protocol === "https:" ? httpsRequest : httpRequest;
      const upstream = request(url, { method: req.method, headers: { ...req.headers, host: url.host } }, response => {
        res.writeHead(response.statusCode ?? 502, response.headers);
        response.pipe(res);
      });
      upstream.on("error", error => {
        if (res.headersSent) res.destroy(error);
        else res.writeHead(502).end();
      });
      res.on("close", () => { if (!res.writableFinished) upstream.destroy(); });
      req.pipe(upstream);
    });
    proxy.listen(0, "127.0.0.1");
    await once(proxy, "listening");
    const address = proxy.address();
    if (!address || typeof address === "string") throw new Error("Expected an HTTP listener");
    const url = `http://127.0.0.1:${address.port}`;
    try {
      await use({
        url, downloads,
        async connect(options) {
          const fixture = await createArchiveFixture((close: () => Promise<void>) => cleanup.push(close), { ...options, publicAppUrl: url });
          apiOrigin = new URL(fixture.base).origin;
          return fixture;
        },
      });
    } finally {
      proxy.closeAllConnections();
      await new Promise<void>(resolve => proxy.close(() => resolve()));
      await Promise.all(cleanup.map(close => close()));
    }
  },
});

async function readZip(download: Download) {
  const chunks: Buffer[] = [];
  for await (const chunk of (await download.createReadStream())!) chunks.push(Buffer.from(chunk));
  return JSZip.loadAsync(Buffer.concat(chunks));
}

test("ZIP starts a normal download and includes attachments beyond the first API page", async ({ page, zipOrigin }, testInfo) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  const formId = "20000000-0000-4000-8000-000000000001";
  const file = (id: string) => ({ name: "Документ.pdf", content: `public/${formId}/${id}.pdf`, type: "application/pdf" });
  const legacy = { name: "Документ.pdf", content: "data:application/pdf;base64,AAEC/w==", type: "application/pdf" };
  const responseData: Array<Record<string, unknown>> = Array.from({ length: 101 }, () => ({}));
  responseData[0] = { files: [file("one"), file("two")] };
  responseData[100] = { people: [{ proof: [file("three")] }], legacy: [legacy], unrelated: file("ignore") };
  const { pageErrors, form, responses, token } = await openSurveyApp(page, { baseURL: zipOrigin.url, responseCount: 101, responseData, pages: [{ elements: [
    { type: "file", name: "files", title: "Документы" },
    { type: "paneldynamic", name: "people", templateElements: [{ type: "file", name: "proof", title: "Документы" }] },
    { type: "panel", name: "panel", elements: [{ type: "file", name: "legacy", title: "Документы" }] },
    { type: "text", name: "unrelated" },
  ] }] });
  const { requests } = await zipOrigin.connect({
    savedForm: form, answers: responses, employeeToken: token,
    storage: Object.fromEntries(["one.pdf", "two.pdf", "three.pdf"].map(name => [name, `Original bytes: ${name}`])),
  });
  const browserStorageRequests: string[] = [];
  page.on("request", request => {
    if (/\/storage\/v1\/object\/|\/rpc\/export_form_responses/.test(request.url())) browserStorageRequests.push(request.url());
  });
  const responseUrl = `${zipOrigin.url}/dashboard/forms/${formId}/responses`;
  await page.goto(responseUrl);
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
  expect(requests.filter(request => request.path.startsWith("/storage/v1/")).length).toBe(3);
  expect(browserStorageRequests).toEqual([]);
  await expect(page.getByText("Скачивание ZIP началось", { exact: true })).toBeVisible();
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
  expect(requests.filter(request => request.body).map(request => request.body.p_response_ids)).toEqual([null, [responses[100].id]]);
  expect(zipOrigin.downloads).toEqual(Array(2).fill({ hasCookie: true, hasAuthorization: false }));
  await expect(page).toHaveURL(responseUrl);
  expect(pageErrors).toEqual([]);
});

test("ZIP uses a nested organization, reports a missing attachment and permits a complete retry", async ({ page, zipOrigin }) => {
  const formId = "20000000-0000-4000-8000-000000000001";
  const organizationId = "40000000-0000-4000-8000-000000000001";
  const schoolsQuestion = {
    type: "matrixdynamic",
    name: "schools",
    detailElements: [{ type: "organization", name: "school", title: "Организация" }],
  };
  const { pageErrors, form, responses, token } = await openSurveyApp(page, { baseURL: zipOrigin.url, responseCount: 1, responseData: [{ schools: [{ school: organizationId }], files: [
    { name: "available.txt", content: `public/${formId}/available.txt` },
    { name: "missing.txt", content: `public/${formId}/missing.txt` },
  ] }], elements: [
    schoolsQuestion,
    { type: "file", name: "files", title: "Файлы" },
  ] });
  const storage: Record<string, string> = { "available.txt": "File content" };
  await zipOrigin.connect({ savedForm: form, answers: responses, employeeToken: token, storage });
  await page.goto(`${zipOrigin.url}/dashboard/forms/${formId}/responses`);
  const button = page.getByRole("button", { name: "Файлы в ZIP", exact: true });
  let pending = page.waitForEvent("download");
  await button.click();
  const partial = await readZip(await pending);
  expect(Object.keys(partial.files)).toHaveLength(2);
  expect(await partial.file("Не удалось скачать.txt")!.async("string")).toContain("ГБОУ 373 — 001/2_missing.txt");
  await expect(page.getByText("Скачивание ZIP началось", { exact: true })).toBeVisible();
  await expect(button).toBeEnabled();
  storage["missing.txt"] = "File content";
  pending = page.waitForEvent("download");
  await button.click();
  const complete = await readZip(await pending);
  expect(Object.keys(complete.files).sort()).toEqual([
    "ГБОУ 373 — 001/1_available.txt",
    "ГБОУ 373 — 001/2_missing.txt",
  ]);
  expect(complete.file("Не удалось скачать.txt")).toBeNull();
  expect(await Promise.all(Object.values(complete.files).map(file => file.async("string")))).toEqual(["File content", "File content"]);
  await expect(button).toBeEnabled();
  expect(pageErrors).toEqual([]);
});
