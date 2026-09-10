import { expect, test } from "@playwright/test";
import ExcelJS from "exceljs";

// All API traffic is intercepted; this scenario never writes to a real backend.
test("200 answers preserve 16 duplicated comments in the table, XLSX, HTML, and report, and delete in batches", async ({ page }, testInfo) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  const userId = "10000000-0000-4000-8000-000000000001";
  const formId = "20000000-0000-4000-8000-000000000001";
  const user = { id: userId, aud: "authenticated", role: "authenticated", email: "test@example.test", app_metadata: {}, user_metadata: {}, created_at: "2026-01-01T00:00:00Z" };
  const token = [
    { alg: "HS256", typ: "JWT" },
    { sub: userId, aud: "authenticated", role: "authenticated", exp: Math.floor(Date.now() / 1000) + 3600 },
  ].map((part) => Buffer.from(JSON.stringify(part)).toString("base64url")).join(".") + ".test-signature";
  const commentTitle = "КОММЕНТАРИИ. Если не выполнено, то почему?";
  const questions = Array.from({ length: 16 }, (_, index) => [
    { type: "dropdown", name: `question${index + 1}`, title: `Пункт ${index + 1}`, choices: ["выполнено", "не выполнено"] },
    { type: "comment", name: `comment${index + 1}`, title: commentTitle },
  ]).flat();
  let responses = Array.from({ length: 200 }, (_, index) => ({
    id: `30000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    form_id: formId, data: {
      // Response key order differs from schema; the last optional comment is always empty.
      ...Object.fromEntries(Array.from({ length: 16 }, (_, questionIndex) => [
        [`question${questionIndex + 1}`, "не выполнено"],
        ...(questionIndex === 15 ? [] : [[`comment${questionIndex + 1}`, `Комментарий ${questionIndex + 1}, ответ ${index + 1}`]]),
      ]).flat().reverse()),
      name: `Ответ ${index + 1}`,
    }, created_at: "2026-01-01T00:00:00Z",
  }));
  const form = { id: formId, title: "Проверка полного списка", author_id: userId, author_name: "Тест", is_public: true,
    form_type: "anketa", form_reason: "plan", deadline_at: null, max_responses: null, created_at: "2026-01-01T00:00:00Z",
    schema: { pages: [{ elements: [{ type: "text", name: "name", title: "Имя" }, ...questions] }] },
  };
  const deletedBatchSizes: number[] = [];
  const listRequests: Array<{ cursor: string | null; limit: number }> = [];
  const forms = Array.from({ length: 220 }, (_, index) => ({ ...form, id: `20000000-0000-4000-8000-${String(220 - index).padStart(12, "0")}`, title: `Карточка ${index + 1}` }));
  await page.routeWebSocket("**/*", (socket) => socket.close());
  await page.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname.includes("/auth/v1/")) {
      return route.fulfill({ json: url.pathname.endsWith("/token")
        ? { access_token: token, refresh_token: "test-refresh-token", token_type: "bearer", expires_in: 3600, user }
        : user });
    }
    if (url.pathname.endsWith("/functions/v1/form-admin")) {
      const body = request.postDataJSON();
      expect(body.action).toBe("delete-responses");
      expect(body.responseIds.length).toBeLessThanOrEqual(100);
      deletedBatchSizes.push(body.responseIds.length);
      responses = responses.filter((response) => !body.responseIds.includes(response.id));
      return route.fulfill({ json: { success: true } });
    }
    if (url.pathname.includes("/rest/v1/")) {
      const table = url.pathname.split("/").pop();
      if (table === "profiles") return route.fulfill({ json: { ...user, name: "Тест", role: "admin", is_disabled: false } });
      if (table === "app_branding") return route.fulfill({ json: { id: 1, sidebar_logo_path: null } });
      if (table === "get_dashboard_forms_stats") return route.fulfill({ json: [{ total_count: 220, active_count: 220, forms_with_deadline_count: 0 }] });
      if (table === "forms") return route.fulfill({ json: { ...form, responses_count: responses.length } });
      if (table === "list_forms_keyset") {
        expect(url.searchParams.has("offset")).toBe(false);
        expect(request.method()).toBe("GET");
        const cursor = url.searchParams.get("p_before_id");
        const offset = cursor ? forms.findIndex((row) => row.id === cursor) + 1 : 0;
        const limit = Number(url.searchParams.get("limit") ?? 20);
        listRequests.push({ cursor, limit });
        return route.fulfill({ json: forms.slice(offset, offset + limit) });
      }
      if (table === "responses") {
        const offset = Number(url.searchParams.get("offset") ?? 0);
        const limit = Number(url.searchParams.get("limit") ?? 100);
        if (offset > 0 && offset >= responses.length) {
          return route.fulfill({ status: 416, json: { code: "PGRST103", message: "Requested range not satisfiable" } });
        }
        const rows = responses.slice(offset, offset + limit);
        return route.fulfill({ json: rows, headers: {
          "access-control-expose-headers": "Content-Range",
          "content-range": rows.length ? `${offset}-${offset + rows.length - 1}/${responses.length}` : `*/${responses.length}`,
        } });
      }
      return route.fulfill({ json: [] });
    }
    if (url.hostname !== "127.0.0.1" && url.hostname !== "localhost") return route.abort();
    return route.continue();
  });
  await page.goto("/login");
  await expect(page.getByRole("button", { name: "Войти", exact: true })).toBeVisible();
  const startupFiles = await page.evaluate(() => performance.getEntriesByType("resource").map((resource) => new URL(resource.name).pathname));
  expect(startupFiles.filter((path) => /survey-(core|creator|react)|exceljs|sentry/.test(path))).toEqual([]);
  await page.getByPlaceholder("Электронная почта").fill(user.email);
  await page.getByPlaceholder("Пароль").fill("test-only-password");
  await page.getByRole("button", { name: "Войти" }).click();
  await expect(page).toHaveURL(/dashboard/);
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
  await page.goto(`/form/${formId}`);
  await expect(page.getByRole("textbox").first()).toBeVisible();
  await page.goto("/builder");
  await expect(page.locator(".builder-host")).toBeVisible();
  await expect(page.locator(".svc-creator")).toBeVisible();
  expect(pageErrors).toEqual([]);
});
