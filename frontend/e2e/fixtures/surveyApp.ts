import { expect, type Page } from "@playwright/test";
import type { SurveyPageSchema, SurveyQuestion, SurveySchema } from "../../src/entities/survey/types";

// Each call creates isolated state. All API traffic is intercepted, including mutations.
export async function openSurveyApp(page: Page, options: { responseCount?: number; responseData?: Array<Record<string, unknown>>; elements?: SurveyQuestion[]; pages?: SurveyPageSchema[] } = {}) {
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
  let responses = Array.from({ length: options.responseCount ?? 200 }, (_, index) => ({
    id: `30000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    form_id: formId, data: options.responseData?.[index] ?? {
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
    schema: { pages: options.pages ?? [{ elements: options.elements ?? [{ type: "text", name: "name", title: "Имя" }, ...questions] }] } as SurveySchema,
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
      if (body.action === "update-schema") {
        form.schema = body.schema;
        form.title = body.title;
        return route.fulfill({ json: { status: "updated", safeChanges: [], warnings: [], breakingChanges: [] } });
      }
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
  return { formId, form, questions, commentTitle, listRequests, deletedBatchSizes, pageErrors };
}
