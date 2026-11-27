import { expect, test, type BrowserContext, type Page } from "@playwright/test";

const userId = "10000000-0000-4000-8000-000000000001";
const formId = "20000000-0000-4000-8000-000000000001";
const sessionId = "10000000-0000-4000-8000-000000000002";
const responses = `/dashboard/forms/${formId}/responses`;
const html = responses + "/html";
const user = {
  id: userId, aud: "authenticated", role: "authenticated", email: "tester@example.test",
  app_metadata: {}, user_metadata: {}, created_at: "2026-01-01T00:00:00Z",
};

const token = (version: number) => [
  { alg: "HS256", typ: "JWT" },
  { sub: userId, aud: "authenticated", role: "authenticated", session_id: sessionId,
    exp: Math.floor(Date.now() / 1000) + 3600, version },
].map(value => Buffer.from(JSON.stringify(value)).toString("base64url")).join(".") + ".test-signature";

async function setup(context: BrowserContext) {
  const old = token(1);
  const fresh = token(2);
  const saved = {
    access_token: old, refresh_token: "original-refresh", token_type: "bearer",
    expires_at: Math.floor(Date.now() / 1000) + 3600, expires_in: 3600, user,
  };
  const state = {
    expired: false, revoked: false, outage: false,
    refreshes: 0, rejectedExports: 0, acceptedExports: 0, archivePosts: 0,
    expireExports: false, rejectArchive: false,
  };
  const draftKey = `survey-builder:draft:${userId}:${formId}`;
  await context.addInitScript(({ saved, draftKey }) => {
    if (localStorage.getItem("e2e-session-initialized")) return;
    localStorage.setItem("e2e-session-initialized", "1");
    localStorage.setItem("sb-supabase-auth-token", JSON.stringify(saved));
    localStorage.setItem(draftKey, '{"schema":{"title":"Мой черновик","pages":[]}}');
  }, { saved, draftKey });
  await context.routeWebSocket("**/*", socket => socket.close());
  await context.route("**/api/office/**", route => {
    if (route.request().url().endsWith("/response-archive")) {
      state.archivePosts++;
      if (state.rejectArchive && route.request().headers().authorization === "Bearer " + old) {
        return route.fulfill({ status: 401, json: { code: "token_expired" } });
      }
      return route.fulfill({ json: { ticket: null } });
    }
    return route.fulfill({ json: { enabled: false } });
  });

  await context.route("https://supabase.e2e.test/**", async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const oldToken = request.headers().authorization === "Bearer " + old;
    const reply = (json: unknown, status = 200, headers: Record<string, string> = {}) => route.fulfill({
      status, json, headers: {
        "access-control-allow-origin": "*",
        "access-control-allow-headers": "*",
        "access-control-allow-methods": "GET, POST, OPTIONS",
        ...headers,
      },
    });
    if (request.method() === "OPTIONS") return reply({});
    if (path === "/auth/v1/user") {
      if (state.outage) return reply({}, 503);
      if (oldToken && state.revoked) return reply({ error_code: "session_not_found", msg: "Session has been revoked" }, 403);
      if (oldToken && state.expired) return reply({ error_code: "bad_jwt", msg: "invalid JWT: token is expired" }, 403);
      return reply(user);
    }
    if (path === "/auth/v1/logout") return route.fulfill({ status: 204, headers: { "access-control-allow-origin": "*" } });
    if (path === "/auth/v1/token") {
      if (request.url().includes("grant_type=refresh_token")) {
        state.refreshes++;
        if (state.revoked) return reply({ error_code: "refresh_token_not_found", msg: "Refresh token not found" }, 400);
        if (state.outage) return reply({}, 503);
      }
      return reply({ ...saved, access_token: fresh, refresh_token: "rotated-refresh" });
    }
    const name = path.split("/").pop();
    if (name === "profiles") return reply({ ...user, name: "Тест", role: "admin", is_disabled: false });
    if (name === "forms") return reply({
      id: formId, title: "Отчёт тестовой формы", author_id: userId, author_name: "Тест", is_public: true,
      form_type: "anketa", form_reason: "plan", responses_count: 1,
      schema: { pages: [{ elements: [{ type: "text", name: "name", title: "Имя" }, { type: "file", name: "proof", title: "Документ" }] }] },
    });
    if (name === "export_form_responses") {
      if (state.expireExports && oldToken) {
        state.rejectedExports++;
        await expect.poll(() => state.rejectedExports).toBe(2);
        return reply({ code: "PGRST303", message: "JWT expired" }, 401);
      }
      state.acceptedExports++;
      return reply([{ id: sessionId, data: { name: "Проверочный ответ" }, created_at: "2026-11-01T00:00:00Z" }]);
    }
    if (name === "responses") return reply([{ id: sessionId, data: { name: "Проверочный ответ" }, created_at: "2026-11-01T00:00:00Z" }],
      200, { "content-range": "0-0/1", "access-control-expose-headers": "Content-Range" });
    if (name === "notification_unread_count") return reply(0);
    return reply([]);
  });
  return { state, draftKey };
}

async function openResponses(page: Page, path = responses) {
  await page.goto(path);
  await expect(page.getByRole("heading", { name: "Отчёт тестовой формы" })).toBeVisible();
  await expect(page.getByText("Ответов: 1", { exact: true })).toBeVisible();
}

test("retains an active session on reload and refreshes a JWT rejected during restoration", async ({ baseURL, context, page }) => {
  const { state } = await setup(context);
  await openResponses(page);
  const previousEntry = await page.locator('script[type="module"][src]').last().getAttribute("src");
  const updatedRelease = process.env.E2E_UPDATED_BASE_URL;
  if (baseURL && updatedRelease) {
    // Keep the browser origin and storage while serving the second build.
    await page.route(`${baseURL}/**`, async route => {
      const url = new URL(route.request().url());
      if (url.pathname.startsWith("/api/")) return route.fallback();
      const response = await route.fetch({ url: new URL(url.pathname + url.search, updatedRelease).href });
      return route.fulfill({ response });
    });
  }
  await page.reload();
  await expect(page.getByRole("heading", { name: "Отчёт тестовой формы" })).toBeVisible();
  if (updatedRelease) await expect(page.locator('script[type="module"][src]').last()).not.toHaveAttribute("src", previousEntry!);
  expect(state.refreshes).toBe(0);

  state.expired = true;
  await page.reload();
  await expect(page.getByRole("heading", { name: "Отчёт тестовой формы" })).toBeVisible();
  expect(state.refreshes).toBe(1);
  await expect(page).toHaveURL(responses);
});

test("two tabs recover and retry HTML and XLSX exports with one refresh", async ({ context, page }) => {
  const { state } = await setup(context);
  const other = await context.newPage();
  await Promise.all([openResponses(page), openResponses(other)]);
  state.expireExports = true;
  const xlsx = page.waitForEvent("download");
  await Promise.all([
    page.getByRole("button", { name: "Скачать XLSX" }).click(),
    other.getByRole("button", { name: "HTML", exact: true }).click(),
  ]);
  await expect(other.getByRole("button", { name: "Скачать HTML" })).toBeEnabled();
  await expect(other.getByText("Проверочный ответ")).toBeVisible();
  expect((await xlsx).suggestedFilename()).toMatch(/\.xlsx$/);
  expect(state.rejectedExports).toBe(2);
  expect(state.acceptedExports).toBe(2);
  expect(state.refreshes).toBe(1);
});

test("revocation during ZIP preflight signs out both tabs and restores the same user's address", async ({ context, page }) => {
  const { state, draftKey } = await setup(context);
  const other = await context.newPage();
  const original = responses + "?view=table#details";
  await openResponses(page, original);
  await openResponses(other);
  state.revoked = true;
  await page.getByRole("button", { name: "Файлы в ZIP" }).click();
  await expect(page).toHaveURL("/login");
  await expect(other).toHaveURL("/login");
  await expect(page.getByText("Сессия отозвана. Войдите снова.")).toBeVisible();
  expect(state.archivePosts).toBe(0);
  expect(state.refreshes).toBe(0);
  expect(await page.evaluate(key => localStorage.getItem(key), draftKey)).toContain("Мой черновик");

  await page.getByLabel("Электронная почта").fill(user.email);
  await page.getByPlaceholder("Пароль").fill("test-password");
  await page.getByRole("button", { name: "Войти" }).click();
  await expect(page).toHaveURL(original);
});

test("a revoked stored session asks for sign-in before showing protected data", async ({ context, page }) => {
  const { state, draftKey } = await setup(context);
  state.revoked = true;
  await page.goto(responses);
  await expect(page).toHaveURL("/login");
  await expect(page.getByText("Сессия отозвана. Войдите снова.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Отчёт тестовой формы" })).toHaveCount(0);
  expect(state.refreshes).toBe(0);
  expect(await page.evaluate(key => localStorage.getItem(key), draftKey)).toContain("Мой черновик");
});

test("a temporary Auth error after reload keeps the stored session and allows retry", async ({ context, page }) => {
  const { state } = await setup(context);
  state.outage = true;
  await page.goto(html);
  await expect(page.getByText(/Сервис авторизации временно недоступен/)).toBeVisible();
  await expect(page).toHaveURL(html);
  expect(await page.evaluate(() => !!localStorage.getItem("sb-supabase-auth-token"))).toBe(true);

  state.outage = false;
  await page.getByRole("button", { name: "Повторить проверку" }).click();
  await expect(page.getByRole("button", { name: "Скачать HTML" })).toBeEnabled();
  expect(state.refreshes).toBe(0);
});

test("an expired token recovers without replaying the ZIP ticket request", async ({ context, page }) => {
  const { state } = await setup(context);
  await openResponses(page);
  state.rejectArchive = true;
  const zip = page.getByRole("button", { name: "Файлы в ZIP" });
  await zip.click();
  await expect(page.getByText("Сессия восстановлена. Повторите действие.")).toBeVisible();
  expect(state.archivePosts).toBe(1);
  expect(state.refreshes).toBe(1);
  await zip.click();
  await expect.poll(() => state.archivePosts).toBe(2);
});
