import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AutomationRule } from "../../entities/automation/model";
import { countActiveFormRules } from "../../entities/automation/api";
import AutomationsPage from "./AutomationsPage";

vi.mock("../../shared/config/env", () => ({
  SUPABASE_URL: "https://supabase.test",
  SUPABASE_ANON_KEY: "test-key",
}));
const { currentUser, showToast } = vi.hoisted(() => ({ currentUser: { id: "owner" }, showToast: vi.fn() }));
vi.mock("../../app/providers/AuthProvider", () => ({
  useAuth: () => ({ user: currentUser }),
}));
vi.mock("../../app/providers/ToastProvider", () => ({ useToast: () => ({ showToast }) }));

const form = { id: "form", title: "Учебная форма" };
const fields = [
  { path: ["topics"], label: "Темы", type: "checkbox", choices: [{ value: 0, text: "Физика" }, "История"] },
  { path: ["school"], label: "Организация", type: "organization" },
  { path: ["panel", "school"], label: "Организация в группе", type: "organization" },
  { path: ["amount"], label: "Количество", type: "text", input_type: "number" },
  { path: ["consent"], label: "Согласие", type: "boolean", choices: [true, false] },
];
const initialRule: AutomationRule = {
  id: "rule", created_at: "2026-11-22T09:00:00Z", form_id: form.id, form: { title: form.title },
  name: "Правило", description: "", enabled: true, event_type: "response_received",
  threshold: null, interval_minutes: null, scheduled_at: null, match_mode: "all", conditions: [],
  action_config: { recipients: ["owner@example.invalid"], subject: "Ответ", body: "Пришёл ответ", mode: "summary" },
};

function renderPage(options: { rule?: object; entry?: string; accessibleForm?: boolean; fieldsReady?: Promise<void> } = {}) {
  let rule = { ...initialRule, ...options.rule };
  const requests: { path: string; params: URLSearchParams; body: Record<string, unknown> | null }[] = [];
  vi.stubGlobal("fetch", async (input: string | URL, init?: RequestInit) => {
    const url = new URL(input);
    const path = url.pathname.replace("/rest/v1/", "");
    const body = typeof init?.body === "string" ? JSON.parse(init.body) as Record<string, unknown> : null;
    requests.push({ path, params: url.searchParams, body });
    switch (path) {
      case "forms": return Response.json(options.accessibleForm === false ? [] : [form]);
      case "rpc/automation_form_fields": await options.fieldsReady; return Response.json(fields);
      case "automation_rules":
        return Response.json(url.searchParams.get("form_id") === "is.null" && rule.form_id ? [] : [rule]);
      case "automation_runs": return Response.json([{
        id: "run", form_id: form.id, form_title: form.title, response_id: "answer",
        status: "failed", recipient_count: 3, sent_count: 1, failed_count: 1, cancelled_count: 1,
        last_error: "Ошибка SMTP", created_at: "2026-11-22T10:00:00Z",
      }]);
      case "rpc/save_automation_rule": return Response.json(rule.id);
      case "rpc/set_automation_rule_enabled":
        rule = { ...rule, enabled: Boolean(body?.p_enabled) };
        return Response.json(null);
      default: throw new Error("Unexpected request: " + path);
    }
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  const page = () => <QueryClientProvider client={client}>
    <MemoryRouter initialEntries={[options.entry ?? "/automations"]}>
      <Routes>
        <Route path="/automations" element={<AutomationsPage />} />
        <Route path="/automations/:ruleId" element={<AutomationsPage />} />
        <Route path="/dashboard/forms/:formId/automations" element={<AutomationsPage />} />
      </Routes>
    </MemoryRouter>
  </QueryClientProvider>;
  const { rerender } = render(page());
  return { requests, user: userEvent.setup(), switchUser(id: string) {
    currentUser.id = id;
    rerender(page());
  } };
}

describe("AutomationsPage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    currentUser.id = "owner";
    showToast.mockClear();
  });

  it("counts enabled rules for the open form and owner without downloading rows", async () => {
    const fetchCount = vi.fn(async (_url: string | URL, _init?: RequestInit) =>
      new Response(null, { headers: { "Content-Range": "0-1/2" } }));
    vi.stubGlobal("fetch", fetchCount);
    expect(await countActiveFormRules("owner", form.id)).toBe(2);
    const [url, init] = fetchCount.mock.calls[0];
    const params = new URL(url).searchParams;
    expect(init?.method).toBe("HEAD");
    expect(params.get("form_id")).toBe("eq.form");
    expect(params.get("user_id")).toBe("eq.owner");
    expect(params.get("enabled")).toBe("eq.true");
  });

  it("loads only global rules without listing forms or exposing form questions", async () => {
    const { requests, user } = renderPage();
    await screen.findByText(/Общих правил пока нет/);
    const query = requests.find(({ path }) => path === "automation_rules")!.params;
    expect(query.get("form_id")).toBe("is.null");
    expect(query.get("user_id")).toBe("eq.owner");
    await user.click(screen.getByRole("button", { name: "Создать правило" }));
    const editor = within(screen.getByRole("dialog"));
    expect(editor.queryByRole("combobox")).not.toBeInTheDocument();
    await user.type(editor.getByLabelText("Название", { exact: true }), "Общее");
    await user.click(editor.getByRole("button", { name: "Далее" }));
    expect(editor.queryByText("Дополнительные условия")).not.toBeInTheDocument();
    expect(editor.queryByRole("option", { name: "Количество ответов по условиям" })).not.toBeInTheDocument();
    expect(requests.some(({ path }) => path === "forms" || path === "rpc/automation_form_fields")).toBe(false);
    await user.click(editor.getByRole("button", { name: "Далее" }));
    expect(editor.queryByLabelText("Получатель из ответа")).not.toBeInTheDocument();
    await user.click(editor.getByRole("button", { name: "Далее" }));
    expect(editor.getByRole("alert")).toHaveTextContent("Укажите получателя письма");
    await user.type(editor.getByLabelText(/Адреса получателей/), "owner@example.org");
    await user.click(editor.getByRole("button", { name: "Далее" }));
    await user.click(editor.getByRole("button", { name: "Сохранить правило" }));
    await waitFor(() => expect(requests.find(({ path }) => path === "rpc/save_automation_rule")?.body).toMatchObject({
      p_form_id: null, p_conditions: [], p_action: { recipients: ["owner@example.org"] },
    }));
  });

  it("discards an open rule editor when the active account changes", async () => {
    const { user, switchUser } = renderPage();
    await user.click(await screen.findByRole("button", { name: "Создать правило" }));
    const editor = within(screen.getByRole("dialog"));
    await user.type(editor.getByLabelText("Название", { exact: true }), "Черновик владельца");
    switchUser("another-user");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("checks ownership and template status before loading a form's rules", async () => {
    const { requests } = renderPage({ entry: "/dashboard/forms/form/automations", accessibleForm: false });
    await screen.findByText("Форма недоступна.");
    const query = requests.find(({ path }) => path === "forms")!.params;
    expect(query.get("id")).toBe("eq.form");
    expect(query.get("author_id")).toBe("eq.owner");
    expect(query.get("form_type")).toBe("neq.template");
    expect(requests.some(({ path }) => path === "automation_rules")).toBe(false);
    expect(screen.queryByRole("button", { name: "Создать правило" })).not.toBeInTheDocument();
  });

  it("saves a multiple-choice condition with a membership comparison by default", async () => {
    const { requests, user } = renderPage({ entry: "/dashboard/forms/form/automations" });
    await user.click(await screen.findByRole("button", { name: "Создать правило" }));
    const editor = within(screen.getByRole("dialog"));
    await user.type(editor.getByLabelText("Название", { exact: true }), "Уведомление");
    expect(editor.getByText(form.title)).toBeInTheDocument();
    expect(requests.find(({ path }) => path === "automation_rules")?.params.get("form_id")).toBe("eq.form");
    await user.click(editor.getByRole("button", { name: "Далее" }));
    await user.click(editor.getByText("Дополнительные условия", { exact: true }));
    const addCondition = await editor.findByRole("button", { name: "Добавить условие" });
    await user.click(addCondition);
    await user.selectOptions(editor.getByLabelText("Вопрос", { exact: true }), '["topics"]');
    expect(editor.getByLabelText("Сравнение")).toHaveValue("any_of");
    await user.click(editor.getByRole("checkbox", { name: "Физика" }));
    await user.click(editor.getByRole("button", { name: "Далее" }));
    await user.type(editor.getByLabelText(/Адреса получателей/), "owner@example.invalid");
    await user.click(editor.getByRole("button", { name: "Далее" }));
    await user.click(editor.getByRole("button", { name: "Сохранить правило" }));
    await waitFor(() => expect(requests.find(({ path }) => path === "rpc/save_automation_rule")?.body).toMatchObject({
      p_form_id: form.id,
      p_conditions: [{ path: ["topics"], op: "any_of", value: ["0"] }],
    }));
    expect(await screen.findByRole("heading", { name: "Правило" })).toBeInTheDocument();
  });

  it("reopens conditions containing numbers and booleans and keeps their values on save", async () => {
    const conditions = [
      { path: ["amount"], op: "gt", value: 5 },
      { path: ["consent"], op: "eq", value: false },
      { path: ["topics"], op: "all_of", value: [0, "История"] },
    ];
    const { requests, user } = renderPage({ entry: "/automations/rule", rule: { conditions } });
    await user.click(await screen.findByRole("button", { name: "Редактировать" }));
    const editor = within(screen.getByRole("dialog"));
    await user.click(editor.getByRole("button", { name: "Далее" }));
    expect(await editor.findByRole("checkbox", { name: "Физика" })).toBeChecked();
    expect(editor.getByRole("checkbox", { name: "История" })).toBeChecked();
    await user.click(editor.getByRole("button", { name: "Далее" }));
    await user.click(editor.getByRole("button", { name: "Далее" }));
    await user.click(editor.getByRole("button", { name: "Сохранить правило" }));
    await waitFor(() => expect(requests.find(({ path }) => path === "rpc/save_automation_rule")?.body).toMatchObject({
      p_conditions: conditions,
    }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("waits for questions and reopens collapsed conditions for a removed choice", async () => {
    let loaded!: () => void;
    const fieldsReady = new Promise<void>(resolve => { loaded = resolve; });
    const { user } = renderPage({ entry: "/automations/rule", fieldsReady,
      rule: { conditions: [{ path: ["topics"], op: "all_of", value: ["Архив", "История"] }] } });
    await user.click(await screen.findByRole("button", { name: "Редактировать" }));
    const editor = within(screen.getByRole("dialog"));
    const next = editor.getByRole("button", { name: "Далее" });
    await user.click(next);
    expect(next).toBeDisabled();
    loaded();
    const missing = await editor.findByRole("checkbox", { name: /Удалённый вариант · Архив/ });
    const details = missing.closest("details")!;
    await user.click(editor.getByText(/Дополнительные условия/));
    expect(details.open).toBe(false);
    await user.click(next);
    expect(editor.getByRole("alert")).toHaveTextContent("Уберите удалённые варианты");
    expect(details.open).toBe(true);
    await user.click(missing);
    await user.click(next);
    expect(editor.getByText("Адреса получателей")).toBeVisible();
  });

  it("repairs an old recipient path and restricts organization recipients to summary", async () => {
    const { requests, user } = renderPage({ entry: "/automations/rule",
      rule: { action_config: { ...initialRule.action_config, recipientPath: ["amount"], mode: "full" } } });
    await user.click(await screen.findByRole("button", { name: "Редактировать" }));
    const editor = within(screen.getByRole("dialog"));
    const next = editor.getByRole("button", { name: "Далее" });
    await user.click(next);
    await user.click(next);
    const recipient = await editor.findByLabelText("Получатель из ответа");
    expect(editor.getByRole("option", { name: /Недоступный вопрос/ })).toBeDisabled();
    expect(editor.queryByRole("option", { name: "Организация в группе" })).toBeNull();
    await user.selectOptions(recipient, '["school"]');
    expect(editor.getByLabelText("Содержание")).toHaveValue("summary");
    expect(editor.getByRole("option", { name: "Полный ответ со ссылкой" })).toBeDisabled();
    await user.click(next);
    await user.click(editor.getByRole("button", { name: "Сохранить правило" }));
    await waitFor(() => expect(requests.find(r => r.path === "rpc/save_automation_rule")?.body).toMatchObject({
      p_action: { recipientPath: ["school"], mode: "summary" },
    }));
  });

  it("checks the schedule limits before showing the email step", async () => {
    const { user } = renderPage({ entry: "/automations/rule", rule: {
      event_type: "recurring", interval_minutes: 1, scheduled_at: "2040-01-01T12:00:00Z",
    } });
    await user.click(await screen.findByRole("button", { name: "Редактировать" }));
    const editor = within(screen.getByRole("dialog"));
    const next = editor.getByRole("button", { name: "Далее" });
    await user.click(next);
    await user.click(next);
    expect(editor.getByRole("alert")).toHaveTextContent("от 15");
    fireEvent.change(editor.getByLabelText("Повторять каждые"), { target: { value: "15" } });
    fireEvent.change(editor.getByLabelText(/Первый запуск/), { target: { value: "2310-01-01T00:00" } });
    await user.click(next);
    expect(editor.getByRole("alert")).toHaveTextContent("2000–2200");
    fireEvent.change(editor.getByLabelText(/Первый запуск/), { target: { value: "2040-01-01T12:00" } });
    await user.click(next);
    expect(editor.getByText("Адреса получателей")).toBeVisible();
  });

  it("keeps the exact time when editing the name of a scheduled rule", async () => {
    const scheduledAt = "2026-11-21T09:12:54.123456+00:00";
    const { requests, user } = renderPage({ entry: "/automations/rule", rule: { event_type: "date", scheduled_at: scheduledAt } });
    await user.click(await screen.findByRole("button", { name: "Редактировать" }));
    const editor = within(screen.getByRole("dialog"));
    const name = editor.getByLabelText("Название", { exact: true });
    await user.clear(name);
    await user.type(name, "Новое название");
    for (let step = 0; step < 3; step++) await user.click(editor.getByRole("button", { name: "Далее" }));
    await user.click(editor.getByRole("button", { name: "Сохранить правило" }));
    await waitFor(() => expect(requests.find(({ path }) => path === "rpc/save_automation_rule")?.body).toMatchObject({
      p_name: "Новое название",
      p_scheduled_at: scheduledAt,
    }));
  });

  it("inserts a substitution in the selected subject position and previews illustrative data", async () => {
    const { user } = renderPage({ entry: "/automations/rule" });
    await user.click(await screen.findByRole("button", { name: "Редактировать" }));
    const editor = within(screen.getByRole("dialog"));
    await user.click(editor.getByRole("button", { name: "Далее" }));
    await user.selectOptions(editor.getByLabelText("Когда срабатывает правило"), "matching_share");
    await user.click(editor.getByRole("button", { name: "Далее" }));
    const subject = editor.getByRole<HTMLInputElement>("textbox", { name: "Тема" });
    await user.click(subject);
    subject.setSelectionRange(0, subject.value.length);
    await user.click(editor.getByText("Подстановки", { exact: true }));
    await user.click(editor.getByRole("button", { name: "Ответов по условиям" }));
    expect(subject).toHaveValue("{{matching_count}}");
    await user.click(editor.getByRole("button", { name: "Далее" }));
    expect(editor.getByText("Пример письма")).toBeInTheDocument();
    expect(editor.getByText("3", { selector: "dd" })).toBeInTheDocument();
    expect(editor.getByText(/условных данных/)).toBeInTheDocument();
    await user.click(editor.getByRole("button", { name: "Назад" }));
    expect(editor.getByRole("textbox", { name: "Тема" })).toHaveValue("{{matching_count}}");
  });

  it("shows delivery history and refreshes the rule after disabling it", async () => {
    const { user } = renderPage({ entry: "/automations/rule" });
    expect(await screen.findByRole("link", { name: "Автоматизации формы" })).toHaveAttribute("href", "/dashboard/forms/form/automations");
    expect(await screen.findByText("Ошибка SMTP")).toBeInTheDocument();
    expect(screen.getByText("Отправлено 1 из 3 · Ошибок: 1 · Отменено: 1")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Открыть ответ" })).toHaveAttribute("href", "/dashboard/forms/form/responses?response=answer");
    await user.click(screen.getByRole("button", { name: "Выключить" }));
    expect(await screen.findByRole("button", { name: "Включить" })).toBeInTheDocument();
  });
});
