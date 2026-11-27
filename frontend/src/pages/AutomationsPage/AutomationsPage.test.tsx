import { supabaseClient } from "../../shared/api";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AutomationRule, AutomationRun } from "../../entities/automation/model";
import { countActiveFormRules } from "../../entities/automation/api";
import { refreshAuthDependentQueries } from "../../app/providers/authCache";
import { TIMELINE_PAGE_SIZE } from "../../shared/api/timelinePage";
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
const schoolId = "23628a77-48d0-4667-b6db-601196fde005";
const failedRun: AutomationRun = {
  id: "run", form_id: form.id, form_title: form.title, response_id: "answer", event_key: "received:answer",
  status: "failed", recipient_count: 3, sent_count: 1, failed_count: 1, cancelled_count: 1,
  last_error: "Ошибка SMTP", created_at: "2026-11-22T10:00:00Z",
};
const fields = [
  { path: ["topics"], label: "Темы", type: "checkbox", choices: [{ value: 0, text: "Физика" }, "История"] },
  { path: ["school"], label: "Организация", type: "organization" },
  { path: ["panel", "school"], label: "Организация в группе", type: "organization" },
  { path: ["amount"], label: "Количество", type: "text", input_type: "number" },
  { path: ["consent"], label: "Согласие", type: "boolean", choices: [true, false] },
];
const initialRule: AutomationRule = {
  id: "rule", created_at: "2026-11-22T09:00:00Z", archived_at: null, form_id: form.id, form: { title: form.title },
  name: "Правило", description: "", enabled: true, event_type: "response_received",
  threshold: null, interval_minutes: null, scheduled_at: null, match_mode: "all", conditions: [],
  action_config: { recipients: ["owner@example.invalid"], subject: "Ответ", body: "Пришёл ответ", mode: "summary" },
};

function renderPage(options: {
  rule?: object;
  runs?: AutomationRun[];
  entry?: string;
  accessibleForm?: boolean;
  fieldsReady?: Promise<void>;
  fieldsUnavailable?: () => boolean;
  saveReady?: Promise<void>;
  paginated?: "automation_rules" | "automation_runs";
} = {}) {
  let rule = { ...initialRule, ...options.rule };
  let failNextPage = true;
  const requests: { path: string; params: URLSearchParams; body: Record<string, unknown> | null }[] = [];
  vi.stubGlobal("fetch", async (input: string | URL, init?: RequestInit) => {
    const url = new URL(input);
    const path = url.pathname.replace("/rest/v1/", "");
    const body = typeof init?.body === "string" ? JSON.parse(init.body) as Record<string, unknown> : null;
    requests.push({ path, params: url.searchParams, body });
    function paginatedResponse<T extends { id: string }>(items: T[]) {
      if (options.paginated !== path) return Response.json(items);
      if (!url.searchParams.has("or")) {
        return Response.json(Array.from({ length: TIMELINE_PAGE_SIZE + 1 }, (_, index) => ({ ...items[0], id: "item-" + index })));
      }
      if (failNextPage) {
        failNextPage = false;
        return Response.json({ message: "Failed to load page" }, { status: 400 });
      }
      return Response.json(items);
    }
    switch (path) {
      case "forms": return Response.json(options.accessibleForm === false ? [] : [form]);
      case "rpc/automation_form_fields":
        await options.fieldsReady;
        return options.fieldsUnavailable?.() ? Response.json({ message: "Offline" }, { status: 503 }) : Response.json(fields);
      case "rpc/list_form_organizations":
        return Response.json([{ id: schoolId, organization_type: "school", number: "45", alias: "ГБОУ школа" }]);
      case "automation_rules": {
        const archived = url.searchParams.get("archived_at");
        if (url.searchParams.get("form_id") === "is.null" && rule.form_id ||
          archived === "is.null" && rule.archived_at || archived === "not.is.null" && !rule.archived_at) {
          return Response.json([]);
        }
        return paginatedResponse([{ ...rule, successful_runs: [{ count: 3 }] }]);
      }
      case "automation_runs": return paginatedResponse(options.runs ?? [failedRun]);
      case "rpc/save_automation_rule":
        await options.saveReady;
        return Response.json(rule.id);
      case "rpc/archive_automation_rule":
        rule = { ...rule, enabled: false, archived_at: "2026-11-23T10:00:00Z" };
        return Response.json(null);
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
  return { client, requests, user: userEvent.setup(), switchUser(id: string) {
    currentUser.id = id;
    refreshAuthDependentQueries(client);
    rerender(page());
  } };
}

describe("AutomationsPage", () => {
  beforeEach(() => {
    vi.spyOn(supabaseClient.auth, "getSession").mockImplementation(async () => ({
      data: { session: { access_token: "test-user-token", user: { id: currentUser.id } } },
      error: null,
    } as Awaited<ReturnType<typeof supabaseClient.auth.getSession>>));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
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
    await screen.findByText("Создайте первое правило, чтобы получать уведомления о новых ответах.");
    const query = requests.find(({ path }) => path === "automation_rules")!.params;
    expect(query.get("form_id")).toBe("is.null");
    expect(query.get("user_id")).toBe("eq.owner");
    await user.click(screen.getByRole("button", { name: "Создать правило" }));
    const editor = within(screen.getByRole("dialog"));
    await user.click(editor.getByRole("button", { name: "Настроить своё правило" }));
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
    expect(editor.getByLabelText(/Адреса получателей/)).toHaveAccessibleDescription(/Укажите получателя письма/);
    await user.type(editor.getByLabelText(/Адреса получателей/), "owner@example.org");
    await user.click(editor.getByRole("button", { name: "Далее" }));
    await user.click(editor.getByRole("button", { name: "Сохранить правило" }));
    await waitFor(() => expect(requests.find(({ path }) => path === "rpc/save_automation_rule")?.body).toMatchObject({
      p_form_id: null, p_conditions: [], p_action: { recipients: ["owner@example.org"] },
    }));
  });

  it("creates a general form closure rule with an aggregate email", async () => {
    const { requests, user } = renderPage();
    await user.click(screen.getByRole("button", { name: "Создать правило" }));
    const editor = within(screen.getByRole("dialog"));
    expect(editor.queryByRole("button", { name: "Отправлять сводку по расписанию" })).not.toBeInTheDocument();
    const scenario = editor.getByRole("button", { name: "Сообщать о завершении сбора ответов" });
    expect(scenario).toHaveAccessibleDescription("Когда форма закрывается вручную, по сроку или достижению лимита.");
    await user.click(scenario);
    await user.click(editor.getByRole("button", { name: "Далее" }));
    expect(editor.getByRole("combobox", { name: "Когда срабатывает правило" })).toHaveValue("form_closed");
    expect(editor.getByRole("option", { name: "Повтор по расписанию" })).toBeInTheDocument();
    await user.click(editor.getByRole("button", { name: "Далее" }));
    await user.type(editor.getByLabelText(/Адреса получателей/), "owner@example.org");
    await user.click(editor.getByText("Подстановки", { exact: true }));
    expect(editor.queryByRole("button", { name: /^Ссылка на ответ$/ })).not.toBeInTheDocument();
    await user.click(editor.getByRole("button", { name: "Далее" }));
    expect(editor.getByText(/Всего ответов: 12/)).toBeVisible();
    await user.click(editor.getByRole("button", { name: "Сохранить правило" }));
    await waitFor(() => expect(requests.find(({ path }) => path === "rpc/save_automation_rule")?.body).toMatchObject({
      p_form_id: null, p_event_type: "form_closed", p_scheduled_at: null, p_interval_minutes: null, p_conditions: [],
      p_action: { mode: "summary", recipients: ["owner@example.org"] },
    }));
  });

  it("prefills a configurable threshold rule and explains an invalid count next to the field", async () => {
    const { requests, user } = renderPage();
    await user.click(await screen.findByRole("button", { name: "Создать правило" }));
    const editor = within(screen.getByRole("dialog"));
    await user.click(editor.getByRole("button", { name: "Сообщать о достижении количества ответов" }));
    expect(editor.getByLabelText("Название", { exact: true })).toHaveValue("Порог ответов");
    const next = editor.getByRole("button", { name: "Далее" });
    await user.click(next);
    expect(editor.getByLabelText("Когда срабатывает правило")).toHaveValue("response_count");
    const threshold = editor.getByLabelText("Количество ответов", { exact: true });
    expect(threshold).toHaveValue(50);
    await user.clear(threshold);
    await user.click(next);
    expect(threshold).toHaveFocus();
    expect(threshold).toHaveAccessibleDescription("Укажите целое число ответов от 1 до 100 000.");
    await user.type(threshold, "100");
    await user.click(next);
    expect(editor.getByLabelText("Тема", { exact: true })).toHaveValue("{{form_title}} — достигнут порог ответов");
    const recipients = editor.getByLabelText(/Адреса получателей/);
    expect(recipients).toHaveValue("");
    await user.type(recipients, "team@example.invalid");
    await user.click(next);
    await user.click(editor.getByRole("button", { name: "Сохранить правило" }));
    await waitFor(() => expect(requests.find(({ path }) => path === "rpc/save_automation_rule")?.body).toMatchObject({
      p_event_type: "response_count", p_threshold: 100, p_action: { recipients: ["team@example.invalid"] },
    }));
  });

  it("prefills a weekly summary for one form and lets users change its schedule", async () => {
    const { user } = renderPage({ entry: "/dashboard/forms/form/automations" });
    await user.click(await screen.findByRole("button", { name: "Создать правило" }));
    const editor = within(screen.getByRole("dialog"));
    expect(editor.queryByRole("button", { name: "Сообщать о завершении сбора ответов" })).not.toBeInTheDocument();
    await user.click(editor.getByRole("button", { name: "Отправлять сводку по расписанию" }));
    await user.click(editor.getByRole("button", { name: "Далее" }));
    expect(editor.getByLabelText("Когда срабатывает правило")).toHaveValue("recurring");
    expect(editor.queryByRole("option", { name: "Завершение сбора ответов" })).not.toBeInTheDocument();
    expect(editor.getByLabelText("Повторять каждые")).toHaveValue(7);
    expect(editor.getByLabelText("Единица времени")).toHaveValue("1440");
    const firstRun = editor.getByLabelText<HTMLInputElement>("Первый запуск по местному времени");
    const firstDate = new Date(firstRun.value);
    expect(firstDate.getDay()).toBe(5);
    expect(firstDate.getHours()).toBe(9);
    expect(firstDate.getTime()).toBeGreaterThan(Date.now());
  });

  it("discards an open rule editor when the active account changes", async () => {
    const { user, switchUser } = renderPage();
    await user.click(await screen.findByRole("button", { name: "Создать правило" }));
    const editor = within(screen.getByRole("dialog"));
    await user.click(editor.getByRole("button", { name: "Настроить своё правило" }));
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
    await user.click(editor.getByRole("button", { name: "Настроить своё правило" }));
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
      rule: { conditions: [{ path: ["topics"], op: "all_of", value: ["Архив", " Архив\t", " История\n"] }] } });
    await user.click(await screen.findByRole("button", { name: "Редактировать" }));
    const editor = within(screen.getByRole("dialog"));
    const next = editor.getByRole("button", { name: "Далее" });
    await user.click(next);
    expect(next).toBeDisabled();
    loaded();
    const missing = await editor.findByRole("checkbox", { name: /Удалённый вариант · Архив/ });
    expect(editor.getAllByRole("checkbox", { name: /Удалённый вариант/ })).toHaveLength(1);
    expect(editor.getByRole("checkbox", { name: "История" })).toBeChecked();
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

  it("keeps the existing recipient during a question-loading error and restores it after retry", async () => {
    let offline = true;
    const { user, requests } = renderPage({ entry: "/automations/rule", fieldsUnavailable: () => offline,
      rule: { action_config: { ...initialRule.action_config, recipientPath: ["school"] } } });
    await user.click(await screen.findByRole("button", { name: "Редактировать" }));
    const editor = within(screen.getByRole("dialog"));
    const next = editor.getByRole("button", { name: "Далее" });
    await user.click(next);
    await user.click(next);
    const recipient = editor.getByLabelText("Получатель из ответа");
    expect(await editor.findByRole("alert")).toHaveTextContent("Не удалось загрузить вопросы");
    expect(recipient).toHaveValue('["school"]');
    expect(recipient).toBeDisabled();
    expect(editor.queryByRole("option", { name: /Недоступный вопрос/ })).not.toBeInTheDocument();
    expect(next).toBeDisabled();

    offline = false;
    await user.click(editor.getByRole("button", { name: "Повторить" }));
    await editor.findByRole("option", { name: "Организация" });
    expect(recipient).toHaveValue('["school"]');
    await user.click(next);
    await user.click(editor.getByRole("button", { name: "Сохранить правило" }));
    await waitFor(() => expect(requests.find(r => r.path === "rpc/save_automation_rule")?.body).toMatchObject({
      p_action: { recipientPath: ["school"] },
    }));
  });

  it("keeps the conditions section open after removing its last condition", async () => {
    const { user } = renderPage({ entry: "/automations/rule",
      rule: { conditions: [{ path: ["topics"], op: "any_of", value: ["История"] }] } });
    await user.click(await screen.findByRole("button", { name: "Редактировать" }));
    const editor = within(screen.getByRole("dialog"));
    await user.click(editor.getByRole("button", { name: "Далее" }));
    const remove = await editor.findByRole("button", { name: "Удалить условие 1" });
    const details = remove.closest("details")!;
    expect(details.open).toBe(true);
    await user.click(remove);
    expect(details.open).toBe(true);
    expect(editor.getByRole("button", { name: "Добавить условие" })).toBeVisible();
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
    expect(editor.getByLabelText(/Первый запуск/)).toHaveAccessibleDescription("Укажите дату и время запуска с 2000 по 2200 год.");
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
    expect(editor.getByRole("alert")).toHaveTextContent("Добавьте хотя бы одно условие.");
    await user.click(await editor.findByRole("button", { name: "Добавить условие" }));
    await user.selectOptions(editor.getByLabelText("Вопрос", { exact: true }), JSON.stringify(["amount"]));
    await user.type(editor.getByLabelText("Значение", { exact: true }), "5");
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

  it("explains what global rules do and loads their full success count with the list", async () => {
    const { requests, user } = renderPage({ rule: { form_id: null, form: null, event_type: "response_count", threshold: 50 } });
    expect(await screen.findByRole("heading", { name: "Общие правила" })).toBeVisible();
    expect(await screen.findByRole("heading", { name: "Правило" })).toBeVisible();
    expect(screen.getByText("Количество ответов достигает 50")).toBeVisible();
    expect(screen.getByText("Отправить письмо указанному получателю")).toBeVisible();
    expect(screen.getByText("Успешных запусков: 3")).toBeVisible();
    const list = requests.find(({ path }) => path === "automation_rules")!.params;
    expect(list.get("select")).toContain("successful_runs:automation_runs(count)");
    expect(list.get("successful_runs.status")).toBe("eq.succeeded");
    expect(requests.some(({ path }) => path === "automation_runs")).toBe(false);
    await user.click(screen.getByRole("link", { name: /Подробнее.*Правило/ }));
    expect(await screen.findByRole("heading", { name: "История срабатываний" })).toBeVisible();
  });

  it("identifies the event and form from each stored run after the rule changes", async () => {
    renderPage({ entry: "/automations/rule", rule: { form_id: null, form: null, event_type: "date" }, runs: [
      failedRun,
      { ...failedRun, id: "schedule", event_key: "slot:123", form_id: "another-form", form_title: "Вторая форма",
        response_id: null, status: "succeeded", recipient_count: 1, sent_count: 1, failed_count: 0, cancelled_count: 0,
        last_error: null },
    ] });
    expect(await screen.findByRole("heading", { name: "Новый ответ на форму «Учебная форма»" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Запуск по расписанию для формы «Вторая форма»" })).toBeVisible();
    expect(screen.getByText("Отправлено писем: 1 из 1")).toBeVisible();
    expect(screen.getByRole("link", { name: "Ответы формы" })).toHaveAttribute("href", "/dashboard/forms/another-form/responses");
  });

  it("shows delivery history and refreshes the rule after disabling it", async () => {
    const { user } = renderPage({ entry: "/automations/rule" });
    expect(await screen.findByRole("link", { name: "Автоматизации формы" })).toHaveAttribute("href", "/dashboard/forms/form/automations");
    expect(await screen.findByText("Ошибка SMTP")).toBeInTheDocument();
    expect(screen.getByText("Отправлено писем: 1 из 3")).toBeVisible();
    await user.click(screen.getByText("Подробности отправки"));
    expect(screen.getByText("Ошибок отправки: 1")).toBeVisible();
    expect(screen.getByText("Отменено: 1")).toBeVisible();
    expect(screen.getByRole("link", { name: "Открыть ответ" })).toHaveAttribute("href", "/dashboard/forms/form/responses?response=answer");
    const status = screen.getByRole("button", { name: "Статус правила «Правило»: Включено" });
    expect(status).toHaveTextContent("Включено");
    await user.click(status);
    expect(await screen.findByRole("button", { name: "Статус правила «Правило»: Выключено" })).toBeInTheDocument();
  });

  it("stores organization IDs selected from the form directory", async () => {
    const { requests, user } = renderPage({ entry: "/automations/rule" });
    await user.click(await screen.findByRole("button", { name: "Редактировать" }));
    const editor = within(screen.getByRole("dialog"));
    const next = editor.getByRole("button", { name: "Далее" });
    await user.click(next);
    await user.click(editor.getByText("Дополнительные условия"));
    await user.click(await editor.findByRole("button", { name: "Добавить условие" }));
    await user.selectOptions(editor.getByLabelText("Вопрос", { exact: true }), JSON.stringify(["school"]));
    await user.selectOptions(await editor.findByRole("combobox", { name: "Значение" }), schoolId);
    expect(editor.getByRole<HTMLOptionElement>("option", { name: "ГБОУ школа 45" }).selected).toBe(true);
    expect(requests.find(({ path }) => path === "rpc/list_form_organizations")?.body).toEqual({ p_form_id: form.id });
    await user.click(next);
    expect(editor.getByLabelText("Получатель из ответа")).toBeInTheDocument();
    await user.click(next);
    await user.click(editor.getByRole("button", { name: "Сохранить правило" }));
    await waitFor(() => expect(requests.find(({ path }) => path === "rpc/save_automation_rule")?.body?.p_conditions)
      .toEqual([{ path: ["school"], op: "eq", value: schoolId }]));
  });

  it("does not handle a completed rule creation in a different login session", async () => {
    let releaseSave = () => {};
    const saveReady = new Promise<void>(resolve => { releaseSave = resolve; });
    const { client, requests, switchUser, user } = renderPage({ saveReady });
    await user.click(screen.getByRole("button", { name: "Создать правило" }));
    const editor = within(screen.getByRole("dialog"));
    await user.click(editor.getByRole("button", { name: "Сообщать о новых ответах" }));
    await user.click(editor.getByRole("button", { name: "Далее" }));
    await user.click(editor.getByRole("button", { name: "Далее" }));
    await user.type(editor.getByLabelText(/Адреса получателей/), "owner@example.invalid");
    await user.click(editor.getByRole("button", { name: "Далее" }));
    await user.click(editor.getByRole("button", { name: "Сохранить правило" }));
    await waitFor(() => expect(requests.some(({ path }) => path === "rpc/save_automation_rule")).toBe(true));
    switchUser("another-user");
    releaseSave();
    await waitFor(() => expect(client.isMutating()).toBe(0));
    expect(showToast).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { name: "Автоматизации" })).toBeVisible();
    expect(requests.some(({ path, params }) => path === "automation_rules" && params.has("id"))).toBe(false);
  });

  it.each([
    { path: "automation_rules" as const, entry: "/dashboard/forms/form/automations", message: "Не удалось загрузить следующую страницу правил." },
    { path: "automation_runs" as const, entry: "/automations/rule", message: "Не удалось загрузить следующую страницу истории." },
  ])("retries the failed cursor of $path without refetching the first page", async ({ path, entry, message }) => {
    const { requests, user } = renderPage({ entry, paginated: path });
    await user.click(await screen.findByRole("button", { name: "Показать ещё" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    const getCursors = () => requests.filter(request => request.path === path).map(request => request.params.get("or"));
    const [, cursor] = getCursors();
    expect(cursor).toContain("item-24");
    await user.click(screen.getByRole("button", { name: "Повторить" }));
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
    expect(getCursors()).toEqual([null, cursor, cursor]);
  });

  it("archives a rule without losing access to its history", async () => {
    const { requests, user } = renderPage({ entry: "/automations/rule" });
    await user.click(await screen.findByRole("button", { name: "Архивировать" }));
    const dialog = within(screen.getByRole("dialog", { name: "Архивировать правило?" }));
    expect(dialog.getByRole("button", { name: "Отмена" })).toHaveFocus();
    await user.click(dialog.getByRole("button", { name: "Архивировать" }));
    expect(await screen.findByText("В архиве")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Редактировать" })).not.toBeInTheDocument();
    expect(screen.getByText("Ошибка SMTP")).toBeVisible();
    expect(requests.find(({ path }) => path === "rpc/archive_automation_rule")?.body).toEqual({ p_id: "rule" });
    await user.click(screen.getByRole("link", { name: "Автоматизации формы" }));
    expect(await screen.findByText(/Создайте первое правило/)).toBeVisible();
    await user.selectOptions(screen.getByLabelText("Статус"), "archived");
    expect(await screen.findByRole("link", { name: /Подробнее.*Правило/ })).toBeVisible();
  });
});
