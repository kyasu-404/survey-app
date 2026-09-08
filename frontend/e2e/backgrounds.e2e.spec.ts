import { expect, test } from "@playwright/test";

// Exercise real SurveyJS rendering with Storage on a separate HTTPS origin.
// The auto-started server uses the HTTPS Supabase fixture in playwright.config.ts.
// All API requests are intercepted, including uploads and form saves.
test("gallery and uploaded backgrounds survive saving and public rendering", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const userId = "10000000-0000-4000-8000-000000000001";
  const formId = "20000000-0000-4000-8000-000000000001";
  const user = { id: userId, aud: "authenticated", role: "authenticated", email: "test@example.test", app_metadata: {}, user_metadata: {}, created_at: "2026-01-01T00:00:00Z" };
  const token = [
    { alg: "HS256", typ: "JWT" },
    { sub: userId, aud: "authenticated", role: "authenticated", exp: Math.floor(Date.now() / 1000) + 3600 },
  ].map((part) => Buffer.from(JSON.stringify(part)).toString("base64url")).join(".") + ".test-signature";
  const form = {
    id: formId, title: "Проверка фонов", author_id: userId, author_name: "Тест", is_public: true,
    form_type: "anketa", form_reason: "plan", deadline_at: null, max_responses: null, responses_count: 0,
    created_at: "2026-01-01T00:00:00Z", theme: {} as Record<string, unknown>,
    schema: { title: "Проверка фонов", pages: [{ elements: [{ type: "text", name: "name", title: "Имя" }] }] },
  };
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=", "base64");
  let uploadedPath = "";
  let saves = 0;
  await page.routeWebSocket("**/*", (socket) => socket.close());
  await page.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname.includes("/auth/v1/")) {
      return route.fulfill({ json: url.pathname.endsWith("/token")
        ? { access_token: token, refresh_token: "test-refresh-token", token_type: "bearer", expires_in: 3600, user }
        : user });
    }
    if (url.pathname.endsWith("/storage/v1/object/list/survey-assets")) {
      const { prefix } = request.postDataJSON();
      return route.fulfill({ json: prefix === "gallery"
        ? [{ id: "gallery-background", name: "gallery.png" }]
        : uploadedPath ? [{ id: "uploaded-background", name: uploadedPath.split("/").pop() }] : [] });
    }
    if (url.pathname.includes("/storage/v1/object/public/survey-assets/")) {
      return route.fulfill({ contentType: "image/png", body: png });
    }
    if (url.pathname.includes("/storage/v1/object/survey-assets/") && request.method() === "POST") {
      uploadedPath = url.pathname.split("/object/survey-assets/")[1];
      return route.fulfill({ json: { Key: `survey-assets/${uploadedPath}` } });
    }
    if (url.pathname.endsWith("/storage/v1/object/survey-assets") && request.method() === "DELETE") {
      return route.fulfill({ json: [] });
    }
    if (url.pathname.endsWith("/functions/v1/form-admin")) {
      const body = request.postDataJSON();
      expect(body.action).toBe("update-schema");
      form.theme = body.theme;
      saves += 1;
      return route.fulfill({ json: { status: "updated", safeChanges: [], warnings: [], breakingChanges: [] } });
    }
    if (url.pathname.includes("/rest/v1/")) {
      const table = url.pathname.split("/").pop();
      if (table === "profiles") return route.fulfill({ json: { ...user, name: "Тест", role: "admin", is_disabled: false } });
      if (table === "app_branding") return route.fulfill({ json: { id: 1, sidebar_logo_path: null } });
      if (table === "list_forms_keyset") return route.fulfill({ json: [form] });
      if (table === "forms") return route.fulfill({ json: url.searchParams.has("id") ? form : [form] });
      if (table === "get_dashboard_forms_stats") return route.fulfill({ json: [{ total_count: 1, active_count: 1, forms_with_deadline_count: 0 }] });
      return route.fulfill({ json: [] });
    }
    if (url.hostname !== "127.0.0.1" && url.hostname !== "localhost") return route.abort();
    return route.continue();
  });

  const expectBackground = async (path: string) => {
    await expect.poll(() => page.evaluate((expectedPath) =>
      Array.from(document.querySelectorAll<HTMLElement>("[style]")).some((element) =>
        element.getBoundingClientRect().height > 0
        && getComputedStyle(element).backgroundImage.includes(expectedPath)), path),
    ).toBe(true);
  };
  const openGallery = async () => {
    await page.getByRole("tab", { name: "Темы", exact: true }).click();
    await page.getByRole("button", { name: "Галерея фонов", exact: true }).click();
    return page.getByRole("dialog", { name: "Галерея фонов" });
  };

  await page.goto("/login");
  await page.getByPlaceholder("Электронная почта").fill(user.email);
  await page.getByPlaceholder("Пароль").fill("test-only-password");
  await page.getByRole("button", { name: "Войти" }).click();
  await expect(page).toHaveURL(/dashboard/);
  await page.goto(`/builder/${formId}`);
  const gallery = await openGallery();
  const common = gallery.locator(".theme-background-card").filter({ hasText: "gallery.png" });
  const imageUrl = await common.locator("img").getAttribute("src");
  expect(new URL(imageUrl!).protocol).toBe("https:");
  expect(new URL(imageUrl!).origin).not.toBe(new URL(page.url()).origin);
  await common.getByRole("button").click();
  await gallery.getByRole("button", { name: "Закрыть", exact: true }).click();
  await expectBackground("/gallery/gallery.png");
  await page.getByRole("button", { name: "Сохранить тему", exact: true }).click();
  await expect.poll(() => saves).toBe(1);
  expect(form.theme.backgroundImage).toBe(`__APP_SURVEY_ASSET__/${uploadedPath}`);
  await expect(page).toHaveURL(/dashboard/);
  await page.goto(`/builder/${formId}`);
  await openGallery();
  await expect(gallery.locator(".theme-background-card-selected img")).toHaveAttribute("src", new RegExp(uploadedPath));
  await gallery.locator('input[type="file"]').setInputFiles({ name: "custom.png", mimeType: "image/png", buffer: png });
  await expect(gallery.locator(".theme-background-card-selected img")).toHaveAttribute("src", /\/forms\/.+\.png$/);
  await gallery.getByRole("button", { name: "Закрыть", exact: true }).click();
  await expectBackground(uploadedPath);
  await page.getByRole("button", { name: "Сохранить тему", exact: true }).click();
  await expect.poll(() => saves).toBe(2);
  expect(form.theme.backgroundImage).toBe(`__APP_SURVEY_ASSET__/${uploadedPath}`);
  await expect(page).toHaveURL(/dashboard/);
  await page.goto(`/form/${formId}`);
  await expectBackground(uploadedPath);
  await expect(page.getByRole("textbox").first()).toBeVisible();
  expect(errors).toEqual([]);
});
