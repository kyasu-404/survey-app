import { focusManager, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Link, MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { prepareFormMail, queueFormInvitations } from "../../entities/mail/api";
import * as responseApi from "../../entities/response/api";
import type { SurveyResponse } from "../../entities/response/types";
import { getFormQueryKey, getFormResponsesQueryKey } from "../../entities/survey/model/queryKeys";
import type { SurveyForm } from "../../entities/survey/types";
import { readAppCss } from "../../test/readAppCss";
import FormResponsesPage from "./FormResponsesPage";

const { deleteResponses, getFormById, loadResponseRows, exportToExcel, exportResponseFilesZip, showToast, getOrganizations } = vi.hoisted(() => ({
  getOrganizations: vi.fn(),
  deleteResponses: vi.fn(),
  getFormById: vi.fn(),
  loadResponseRows: vi.fn(),
  exportToExcel: vi.fn(),
  exportResponseFilesZip: vi.fn(),
  showToast: vi.fn(),
}));

const { createRealtimeChannel, removeRealtimeChannel, emitRealtimeChange, emitRealtimeStatus, resetRealtimeChannel } = vi.hoisted(() => {
  type RealtimeHandler = {
    config: { table?: string };
    callback: (payload?: unknown) => void;
  };
  const changeHandlers: RealtimeHandler[] = [];
  let statusHandler: ((status: string) => void) | undefined;
  const channel = {
    on: vi.fn((_event: string, config: unknown, callback: (payload?: unknown) => void) => {
      changeHandlers.push({
        config: (config ?? {}) as { table?: string },
        callback,
      });
      return channel;
    }),
    subscribe: vi.fn((callback?: (status: string) => void) => { statusHandler = callback; return channel; }),
  };
  const createRealtimeChannel = vi.fn(() => channel);
  const removeRealtimeChannel = vi.fn(() => Promise.resolve("ok"));

  return {
    createRealtimeChannel,
    removeRealtimeChannel,
    emitRealtimeChange: (table?: string, payload?: unknown) => {
      for (const handler of changeHandlers) {
        if (!table || handler.config.table === table) {
          handler.callback(payload);
        }
      }
    },
    emitRealtimeStatus: (status: string) => statusHandler?.(status),
    resetRealtimeChannel: () => {
      statusHandler = undefined;
      changeHandlers.length = 0;
      createRealtimeChannel.mockClear();
      channel.on.mockClear();
      channel.subscribe.mockClear();
      removeRealtimeChannel.mockClear();
    },
  };
});

vi.mock("../../entities/survey/api/surveysApi", () => ({
  getFormById,
}));

vi.mock("../../entities/response/api", () => {
  let snapshot: SurveyResponse[] = [];
  return {
    deleteResponses,
    getResponsesByForm: async (id: string, options: { page: number; pageSize: number; signal?: AbortSignal }) => {
      snapshot = await loadResponseRows(id, options);
      return { data: snapshot.slice((options.page - 1) * options.pageSize, options.page * options.pageSize), count: snapshot.length, totalPages: Math.max(1, Math.ceil(snapshot.length / options.pageSize)) };
    },
    getResponsesForSorting: async () => snapshot,
    getAllResponsesByForm: async (_id: string, options?: { responseIds?: string[] }) => options?.responseIds ? snapshot.filter(row => options.responseIds!.includes(row.id)) : snapshot,
  };
});

vi.mock("../../entities/organization/api", () => ({ getOrganizations }));

vi.mock("../../entities/mail/api", () => ({
  prepareFormMail: vi.fn(),
  queueFormInvitations: vi.fn(),
}));

vi.mock("../../entities/personal-link/api", () => ({
  getPersonalLinks: vi.fn().mockResolvedValue({ available: true, canManage: true, enabled: true, links: [] }),
  setPersonalLinks: vi.fn(),
}));

vi.mock("../../shared/lib/export", () => ({
  exportToExcel,
}));

vi.mock("../../entities/response/lib/responseFilesZip", () => ({ exportResponseFilesZip }));

vi.mock("../../shared/api", () => ({
  MAX_CLIENT_RESPONSE_EXPORT: 10_000,
  RESPONSES_PAGE_SIZE: 50,
  supabaseClient: {
    channel: createRealtimeChannel,
    removeChannel: removeRealtimeChannel,
  },
}));

vi.mock("../../app/providers/ToastProvider", () => ({
  useToast: () => ({
    showToast,
  }),
}));

vi.mock("../../app/providers/AuthProvider", () => ({
  useAuth: () => ({
    user: { id: "user-1" },
    profile: { role: "user" },
  }),
}));

vi.mock("../../features/render-form/SurveyFormRenderer", () => ({
  SurveyFormRenderer: ({
    formId,
    initialData,
    initialPageNo,
    isPreview,
    renderMode,
    schema,
  }: {
    formId: string;
    initialData?: Record<string, unknown>;
    initialPageNo?: number;
    isPreview?: boolean;
    renderMode?: string;
    schema: { title?: string };
  }) => (
    <div
      data-testid="response-preview-renderer"
      data-form-id={formId}
      data-initial-data={JSON.stringify(initialData ?? {})}
      data-initial-page-no={String(initialPageNo ?? "")}
      data-preview={String(Boolean(isPreview))}
      data-render-mode={renderMode ?? ""}
    >
      {schema.title}
    </div>
  ),
}));

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: { retry: false },
    },
  });
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;

  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
}

function createResponse(index: number, name = `Ответ ${index}`): SurveyResponse {
  return {
    id: `response-${index}`,
    form_id: "form-1",
    created_at: "2026-04-08T11:30:00.000Z",
    data: { name },
  };
}

function createFullResponsePage(page: number, pageSize = 100) {
  return Array.from({ length: pageSize }, (_, index) =>
    createResponse((page - 1) * pageSize + index + 1),
  );
}

const invitationForm = {
  id: "form-1",
  title: "Опрос",
  author_id: "user-1",
  form_type: "anketa",
  form_reason: "plan",
  is_public: true,
  deadline_at: null,
  created_at: "2026-04-08T10:00:00.000Z",
  personal_links_enabled: true,
  organization_types: ["school"],
  schema: { pages: [{ elements: [{ type: "organization", name: "organization" }] }] },
  theme: {},
} satisfies SurveyForm;

function renderEmptyResponses(form: SurveyForm | null = invitationForm) {
  getFormById.mockResolvedValue(form);
  loadResponseRows.mockResolvedValue([]);
  getOrganizations.mockResolvedValue([]);
  render(
    <MemoryRouter initialEntries={["/dashboard/forms/form-1/responses"]}>
      <QueryClientProvider client={createQueryClient()}>
        <Routes>
          <Route path="/dashboard/forms/:id/responses" element={<FormResponsesPage />} />
        </Routes>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe("FormResponsesPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    deleteResponses.mockResolvedValue(undefined);
    resetRealtimeChannel();
  });

  it("copies the public URL from the empty response state", async () => {
    const user = userEvent.setup();
    const clipboard = vi.spyOn(navigator.clipboard, "writeText");
    renderEmptyResponses();

    await user.click(await screen.findByRole("button", { name: "Скопировать ссылку" }));

    expect(clipboard).toHaveBeenCalledExactlyOnceWith(`${window.location.origin}/form/form-1`);
    expect(showToast).toHaveBeenCalledWith("Ссылка скопирована", "success");
    clipboard.mockRestore();
  });

  it("shows a selectable public URL when clipboard access fails", async () => {
    const user = userEvent.setup();
    const clipboard = vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(new Error("Clipboard access denied"));
    renderEmptyResponses();

    await user.click(await screen.findByRole("button", { name: "Скопировать ссылку" }));

    const dialog = await screen.findByRole("dialog", { name: "Поделиться формой Опрос" });
    const url = within(dialog).getByRole("textbox", { name: "Ссылка на форму" });
    expect(url).toHaveValue(`${window.location.origin}/form/form-1`);
    expect(url).toHaveAttribute("readonly");
    clipboard.mockRestore();
  });

  it("opens invitation recipient selection without sending any mail", async () => {
    vi.mocked(prepareFormMail).mockResolvedValue({
      personal: true,
      smtpEnabled: true,
      template: { subject: "Опрос", bodyText: "Заполните {Ссылка}" },
      recipients: [{ id: "school-1", name: "Школа 1", email: "school@example.org", organizationType: "school", canSend: true }],
    });
    const user = userEvent.setup();
    renderEmptyResponses();

    expect(prepareFormMail).not.toHaveBeenCalled();
    const invite = await screen.findByRole("button", { name: "Отправить приглашения" });
    expect(screen.getByText("Скопируйте ссылку на форму или отправьте приглашения.")).toBeVisible();
    await user.click(invite);

    const dialog = await screen.findByRole("dialog", { name: "Поделиться формой Опрос" });
    expect(await within(dialog).findByRole("checkbox", { name: /Школа 1/ })).toBeVisible();
    expect(prepareFormMail).toHaveBeenCalledExactlyOnceWith("form-1", "invitation");
    expect(queueFormInvitations).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole("button", { name: "Закрыть окно поделиться" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(invite).toHaveFocus();
  });

  it.each([
    ["another author", { author_id: "another-author" }],
    ["personal links disabled", { personal_links_enabled: false }],
    ["no organization question", { schema: { pages: [] } }],
  ] satisfies Array<[string, Partial<SurveyForm>]>)("offers only the public link with %s", async (_label, settings) => {
    renderEmptyResponses({ ...invitationForm, ...settings });

    expect(await screen.findByRole("button", { name: "Скопировать ссылку" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Отправить приглашения" })).not.toBeInTheDocument();
    expect(screen.getByText("Скопируйте ссылку на форму.")).toBeVisible();
  });

  it.each([
    ["closed form", { is_public: false }],
    ["expired form", { deadline_at: "2020-01-01T00:00:00.000Z" }],
    ["template", { form_type: "template" }],
  ] satisfies Array<[string, Partial<SurveyForm>]>)("omits sharing actions for a %s", async (_label, settings) => {
    renderEmptyResponses({ ...invitationForm, ...settings });

    await screen.findByRole("heading", { name: "Ответов пока нет" });
    expect(screen.queryByRole("button", { name: "Скопировать ссылку" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Отправить приглашения" })).not.toBeInTheDocument();
  });

  it("shows that the form is unavailable instead of sharing an unknown form", async () => {
    renderEmptyResponses(null);

    expect(await screen.findByText("Форма не найдена или недоступна.")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Скопировать ссылку" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Отправить приглашения" })).not.toBeInTheDocument();
  });

  it.each(["user-1", "another-author"])("exports selected answers to ZIP and XLSX for author %s", async (authorId) => {
    const schema = { pages: [{ elements: [{ type: "panel", name: "panel", elements: [{ type: "file", name: "files" }] }] }] };
    getFormById.mockResolvedValue({ id: "form-1", title: "Вложения", author_id: authorId, schema });
    const responses = [createResponse(1), createResponse(2)];
    loadResponseRows.mockResolvedValue(responses);
    const deferred = createDeferred<boolean>();
    exportResponseFilesZip.mockReturnValue(deferred.promise);
    render(<MemoryRouter initialEntries={["/dashboard/forms/form-1/responses"]}>
      <QueryClientProvider client={createQueryClient()}><Routes>
        <Route path="/dashboard/forms/:id/responses" element={<FormResponsesPage />} />
      </Routes></QueryClientProvider>
    </MemoryRouter>);
    const button = await screen.findByRole("button", { name: "Файлы в ZIP" });
    const xlsx = screen.getByRole("button", { name: "Скачать XLSX" });
    expect(xlsx.nextElementSibling).toBe(button);
    expect(button.className).toBe(xlsx.className);
    expect(button.querySelector('[data-icon="download"]')).toBeInTheDocument();
    expect(xlsx.querySelector('[data-icon="download"]')).toBeInTheDocument();
    await userEvent.click(screen.getAllByRole("checkbox", { name: /^Выбрать Ответ/ })[0]);
    if (authorId !== "user-1") expect(screen.queryByRole("button", { name: "Удалить" })).not.toBeInTheDocument();
    await userEvent.click(xlsx);
    await waitFor(() => expect(exportToExcel).toHaveBeenCalledWith(expect.any(Array), "ответы-Вложения", "Ответы", expect.any(Array)));
    expect(exportToExcel.mock.calls[0][0]).toHaveLength(1);
    await userEvent.click(button);
    await waitFor(() => expect(button).toHaveTextContent("Подготовка ZIP"));
    expect(button).toBeDisabled();
    expect(exportResponseFilesZip).toHaveBeenCalledExactlyOnceWith("form-1", [{ id: responses[0].id, number: 1 }], expect.any(AbortSignal));
    await act(async () => deferred.resolve(true));
    expect(button).toBeEnabled();
    expect(showToast).toHaveBeenCalledWith("Скачивание ZIP началось", "success");
  });

  it("keeps response tables square and vertically scrollable inside the table content", () => {
    const css = readAppCss();

    expect(css).toMatch(/\.app-main\s*\{[^}]*min-width:\s*0;/);
    expect(css).toMatch(/\.dashboard-page\s*\{[^}]*min-width:\s*0;/);
    expect(css).toMatch(/\.responses-page-card\s*\{[^}]*min-width:\s*0;/);
    expect(css).toMatch(/\.responses-page-table-shell\s*\{[^}]*max-width:\s*100%;[^}]*max-height:\s*min\(68vh,\s*720px\);[^}]*overflow:\s*auto;[^}]*border-radius:\s*0;/);
    expect(css).toMatch(/\.responses-page-table-shell\s+\.responses-table\s*\{[^}]*width:\s*max-content;[^}]*min-width:\s*100%;/);
    expect(css).toMatch(/\.responses-table\s*\{[^}]*border-radius:\s*0;[^}]*overflow:\s*visible;/);
  });

  it("wraps long response headers and cell values inside the responses table", () => {
    const css = readAppCss();

    expect(css).toMatch(
      /\.responses-table th,\s*\.responses-table td\s*\{[^}]*white-space:\s*pre-wrap;[^}]*overflow-wrap:\s*anywhere;[^}]*word-break:\s*break-word;[^}]*max-width:\s*min\(28rem,\s*40vw\);/s,
    );
  });

  it("renders the form title, type and reason metadata, responses table, and export action", async () => {
    getFormById.mockResolvedValue({
      id: "form-1",
      title: "Форма обратной связи",
      created_at: "2026-04-08T10:00:00.000Z",
      is_public: true,
      author_id: "user-1",
      form_type: "anketa",
      form_reason: "plan",
      deadline_at: null,
      schema: {
        pages: [
          {
            elements: [
              { type: "text", name: "name", title: "Имя" },
            ],
          },
        ],
      },
    });

    const responses: SurveyResponse[] = [
      {
        id: "response-1",
        form_id: "form-1",
        created_at: "2026-04-08T11:30:00.000Z",
        data: {
          name: "Анна",
        },
      },
    ];

    loadResponseRows.mockResolvedValue(responses);

    const { container } = render(
      <MemoryRouter initialEntries={["/dashboard/forms/form-1/responses"]}>
        <QueryClientProvider client={createQueryClient()}>
          <Routes>
            <Route path="/dashboard/forms/:id/responses" element={<FormResponsesPage />} />
          </Routes>
        </QueryClientProvider>
      </MemoryRouter>,
    );

    expect(await screen.findByRole("heading", { name: "Форма обратной связи" })).toBeInTheDocument();
    expect(screen.getByText("Тип: Анкетирование")).toBeInTheDocument();
    expect(screen.getByText("Основание: План работ")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Скачать XLSX" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Файлы в ZIP" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Отчёт" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "HTML" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Обновить" })).not.toBeInTheDocument();
    expect(await screen.findByText("Анна")).toBeInTheDocument();
    expect(container.querySelector(".responses-page-header-copy")).toBeInTheDocument();
    expect(container.querySelector(".responses-export-button .toolbar-icon")).toBeInTheDocument();
    expect(container.querySelector(".responses-table-date-cell")).toHaveTextContent(/^\d{2}\.\d{2}\.\d{4}\d{2}:\d{2}$/);
    expect(container.querySelector(".responses-table-date-cell")).not.toHaveTextContent(/\d{2}:\d{2}:\d{2}/);
    expect(container.querySelectorAll(".responses-table-date-line")).toHaveLength(2);

    await userEvent.click(screen.getByRole("button", { name: "Скачать XLSX" }));

    await waitFor(() => {
      expect(exportToExcel).toHaveBeenCalledWith(
        [
          expect.objectContaining({
            "answer:name": "Анна",
          }),
        ],
        "ответы-Форма обратной связи",
        "Ответы",
        expect.arrayContaining([expect.objectContaining({ key: "answer:name", header: "Имя", answerType: "text" })]),
      );
    });
  });

  it("keeps the responses toolbar below the title, pinned right, and aligned on the button row", () => {
    const css = readAppCss();

    expect(css).toMatch(/\.responses-page-header\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\);/);
    expect(css).toMatch(
      /\.responses-page-toolbar\s*\{[^}]*justify-content:\s*flex-end;[^}]*justify-self:\s*end;[^}]*align-items:\s*flex-end;/,
    );
    expect(css).toMatch(/\.responses-page-header-copy\s*\{[^}]*min-width:\s*0;/);
  });

  it("uses monochrome primary styling with matching icons for export buttons", () => {
    const css = readAppCss();

    expect(css).toMatch(/button\.responses-export-button,\s*button\.dashboard-qr-download-button\s*\{[^}]*background:\s*linear-gradient\(180deg,\s*#27272a,\s*#111111\);[^}]*color:\s*#ffffff;/);
    expect(css).toMatch(/button\.responses-export-button:hover,\s*button\.responses-export-button:focus-visible,\s*button\.dashboard-qr-download-button:hover,\s*button\.dashboard-qr-download-button:focus-visible\s*\{[^}]*background:\s*linear-gradient\(180deg,\s*#3f3f46,\s*#18181b\);[^}]*color:\s*#ffffff;/);
    expect(css).toMatch(/\.responses-export-button\s+img\.toolbar-icon,\s*\.dashboard-qr-download-button\s+img\.toolbar-icon\s*\{[^}]*filter:\s*brightness\(0\)\s*invert\(1\);/);
  });

  it("makes the HTML export button match the XLSX button", () => {
    const css = readAppCss();

    expect(css).toMatch(/button\.responses-export-button\.responses-html-button\s*\{[^}]*background:\s*linear-gradient\(180deg,\s*#27272a,\s*#111111\);[^}]*color:\s*#ffffff;/);
    expect(css).toMatch(/button\.responses-export-button\.responses-html-button:hover,\s*button\.responses-export-button\.responses-html-button:focus-visible\s*\{[^}]*background:\s*linear-gradient\(180deg,\s*#3f3f46,\s*#18181b\);[^}]*color:\s*#ffffff;/);
    expect(css).toMatch(/\.responses-html-button\s+img\.toolbar-icon\s*\{[^}]*filter:\s*brightness\(0\)\s*invert\(1\);/);
  });

  it("uses matching light styles for report, refresh, and directory file buttons", () => {
    const css = readAppCss();

    expect(css).toMatch(/\.users-page-controls \.app-button,[^{]+button\.responses-report-button:disabled\s*\{[^}]*color:\s*var\(--theme-text\);[^}]*border-color:\s*var\(--theme-border\);[^}]*background:\s*var\(--theme-control-background\);/s);
    expect(css).toMatch(/\.responses-page-toolbar button\.dashboard-refresh-button,[^{]+\{[^}]*color:\s*var\(--theme-text\);[^}]*border-color:\s*var\(--theme-border\);[^}]*background:\s*var\(--theme-control-background\);/s);
  });

  it("adds matching hover feedback to report and directory tabs", () => {
    const css = readAppCss();

    expect(css).toMatch(/\.response-report-tabs button\s*\{[^}]*cursor:\s*pointer;[^}]*transition:/);
    expect(css).toMatch(/\.organizations-type-switcher button\s*\{[^}]*cursor:\s*pointer;[^}]*transition:/);
  });

  it("keeps row hover highlighting stronger than alternating row backgrounds", () => {
    const css = readAppCss();

    expect(css).toMatch(/\.responses-table\s+tbody\s+\.responses-table-row-clickable:hover\s+td,\s*\.responses-table\s+tbody\s+\.responses-table-row-clickable:focus-visible\s+td\s*\{[^}]*background:\s*rgba\(251,\s*146,\s*60,\s*0\.14\);/);
  });

  it("keeps the response preview drawer from scrolling horizontally when a dropdown opens", () => {
    const css = readAppCss();

    expect(css).toMatch(/\.response-preview-drawer\s*\{[^}]*width:\s*min\(820px,\s*calc\(100vw - 32px\)\);/);
    expect(css).toMatch(/\.response-preview-drawer\s*\{[^}]*overflow-y:\s*auto;[^}]*overflow-x:\s*clip;/);
    expect(css).toMatch(/\.response-preview-body\.survey-page-card\s*\{[^}]*width:\s*100%;[^}]*max-width:\s*100%;[^}]*min-width:\s*0;[^}]*overflow:\s*visible;/);
    expect(css).toMatch(
      /\.template-preview-drawer,\s*\.response-preview-drawer\s*\{[^}]*background:\s*var\(--theme-surface-muted\);/s,
    );
    expect(css).toMatch(
      /\.template-preview-body\.survey-page-card,\s*\.response-preview-body\.survey-page-card\s*\{[^}]*padding:\s*0;[^}]*background:\s*transparent\s*!important;/s,
    );
  });

  it("keeps the response preview controls and question descriptions on the requested styling", () => {
    const css = readAppCss();

    expect(css).toMatch(/\.response-preview-close\s*\{[^}]*border:\s*0;[^}]*background:\s*#111111;[^}]*color:\s*#ffffff;/);
    expect(css).toMatch(
      /\.survey-runtime-surface\.survey-page-card \.sd-question \.sd-description,\s*\.survey-runtime-surface\.survey-page-card \.sd-question__description\s*\{[^}]*width:\s*fit-content;[^}]*background:\s*rgba\(219,\s*234,\s*254,\s*0\.88\)\s*!important;/s,
    );
    expect(css).not.toMatch(
      /\.response-preview-builder-palette\.survey-page-card \.sd-question \.sd-description,\s*\.response-preview-builder-palette\.survey-page-card \.sd-question__description\s*\{[^}]*background:\s*rgba\(255,\s*255,\s*255,\s*0\.72\)\s*!important;/,
    );
  });

  it("refreshes responses after a realtime database change", async () => {
    getFormById.mockResolvedValue({
      id: "form-1",
      title: "Форма обратной связи",
      created_at: "2026-04-08T10:00:00.000Z",
      is_public: true,
      author_id: "user-1",
      form_type: "anketa",
      form_reason: "plan",
      deadline_at: null,
      schema: {
        pages: [
          {
            elements: [{ type: "text", name: "name", title: "Имя" }],
          },
        ],
      },
    });

    loadResponseRows
      .mockResolvedValueOnce([
        {
          id: "response-1",
          form_id: "form-1",
          created_at: "2026-04-08T11:30:00.000Z",
          data: { name: "Анна" },
        },
      ])
      .mockResolvedValueOnce([
        {
          id: "response-2",
          form_id: "form-1",
          created_at: "2026-04-08T11:31:00.000Z",
          data: { name: "Борис" },
        },
        {
          id: "response-1",
          form_id: "form-1",
          created_at: "2026-04-08T11:30:00.000Z",
          data: { name: "Анна" },
        },
      ]);

    render(
      <MemoryRouter initialEntries={["/dashboard/forms/form-1/responses"]}>
        <QueryClientProvider client={createQueryClient()}>
          <Routes>
            <Route path="/dashboard/forms/:id/responses" element={<FormResponsesPage />} />
          </Routes>
        </QueryClientProvider>
      </MemoryRouter>,
    );

    expect(await screen.findByText("Анна")).toBeInTheDocument();

    emitRealtimeChange("responses");

    await waitFor(() => {
      expect(loadResponseRows).toHaveBeenCalledTimes(2);
    });

    expect(await screen.findByText("Борис")).toBeInTheDocument();
    expect(getFormById).toHaveBeenCalledTimes(1);
  });

  it.each([7, "9007199254740993"])("refreshes rows without fetching the schema for a counter event at revision %s", async (revision) => {
    const queryClient = createQueryClient();
    const baseForm = {
      id: "form-1",
      title: "Форма обратной связи",
      created_at: "2026-04-08T10:00:00.000Z",
      is_public: true,
      author_id: "user-1",
      form_type: "anketa",
      form_reason: "plan",
      deadline_at: null,
      responses_count: 1,
      revision,
      schema: {
        pages: [
          {
            elements: [{ type: "text", name: "name", title: "Имя" }],
          },
        ],
      },
    };

    getFormById.mockResolvedValue(baseForm);

    loadResponseRows
      .mockResolvedValueOnce([
        {
          id: "response-1",
          form_id: "form-1",
          created_at: "2026-04-08T11:30:00.000Z",
          data: { name: "Анна" },
        },
      ])
      .mockResolvedValueOnce([
        {
          id: "response-2",
          form_id: "form-1",
          created_at: "2026-04-08T11:31:00.000Z",
          data: { name: "Борис" },
        },
        {
          id: "response-1",
          form_id: "form-1",
          created_at: "2026-04-08T11:30:00.000Z",
          data: { name: "Анна" },
        },
      ]);

    render(
      <MemoryRouter initialEntries={["/dashboard/forms/form-1/responses"]}>
        <QueryClientProvider client={queryClient}>
          <Routes>
            <Route path="/dashboard/forms/:id/responses" element={<FormResponsesPage />} />
          </Routes>
        </QueryClientProvider>
      </MemoryRouter>,
    );

    expect(await screen.findByText("Анна")).toBeInTheDocument();

    act(() => emitRealtimeChange("forms", {
      new: { id: "form-1", revision: String(revision), responses_count: 2 },
      commit_timestamp: new Date(Date.now() + 1000).toISOString(),
    }));

    await waitFor(() => {
      expect(loadResponseRows).toHaveBeenCalledTimes(2);
    });

    expect(await screen.findByText("Борис")).toBeInTheDocument();
    expect(screen.getByText("Ответов: 2")).toBeInTheDocument();
    expect(queryClient.getQueryData(getFormQueryKey("form-1"))).toMatchObject({ responses_count: 2, revision });
    expect(getFormById).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["schema", { revision: "9007199254740994" }, {
      schema: { pages: [{ elements: [{ type: "text", name: "name", title: "Новое имя" }] }] },
    }],
    ["closing status", { revision: "9007199254740994", is_public: false }, { is_public: false }],
    ["missing revision", { responses_count: 2 }, { title: "Изменённая форма" }],
    ["invalid counter", { revision: "9007199254740993", responses_count: -1 }, { title: "Изменённая форма" }],
    ["missing form id", { id: undefined, revision: "9007199254740993" }, { title: "Изменённая форма" }],
    ["unsafe numeric revision", { revision: 9007199254740992, responses_count: 2 }, { title: "Изменённая форма" }],
    ["unknown payload", null, { title: "Изменённая форма" }],
  ])("reloads the form after a %s event", async (_reason, change, updatedFields) => {
    const queryClient = createQueryClient();
    const form = {
      id: "form-1", title: "Форма", author_id: "user-1", revision: "9007199254740993",
      is_public: true, responses_count: 1,
      schema: { pages: [{ elements: [{ type: "text", name: "name", title: "Имя" }] }] },
    };
    getFormById.mockResolvedValueOnce(form).mockResolvedValueOnce({ ...form, ...updatedFields });
    loadResponseRows.mockResolvedValue([createResponse(1)]);
    render(<MemoryRouter initialEntries={["/forms/form-1/responses"]}>
      <QueryClientProvider client={queryClient}><Routes>
        <Route path="/forms/:id/responses" element={<FormResponsesPage />} />
      </Routes></QueryClientProvider>
    </MemoryRouter>);
    expect(await screen.findByText("Ответ 1")).toBeInTheDocument();
    act(() => emitRealtimeChange("forms", change && {
      new: { id: "form-1", responses_count: 2, ...change },
      commit_timestamp: new Date(Date.now() + 1000).toISOString(),
    }));
    await waitFor(() => expect(queryClient.getQueryData(getFormQueryKey("form-1"))).toMatchObject(updatedFields));
    expect(getFormById).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(loadResponseRows).toHaveBeenCalledTimes(2));
  });

  it.each([
    ["a delayed event behind the HTTP snapshot", 3, 2, 3],
    ["a newer event behind HTTP completion time or client clock", 1, 2, 2],
  ])("reconciles %s without trusting client timestamps", async (_reason, cachedCount, eventCount, freshCount) => {
    const queryClient = createQueryClient();
    const form = {
      id: "form-1", title: "Форма", author_id: "user-1", revision: "9007199254740993", responses_count: cachedCount,
      schema: { pages: [{ elements: [{ type: "text", name: "name", title: "Имя" }] }] },
    };
    getFormById.mockReset().mockResolvedValueOnce(form).mockResolvedValueOnce({ ...form, responses_count: freshCount });
    loadResponseRows.mockResolvedValue([createResponse(1)]);
    render(<MemoryRouter initialEntries={["/forms/form-1/responses"]}>
      <QueryClientProvider client={queryClient}><Routes>
        <Route path="/forms/:id/responses" element={<FormResponsesPage />} />
      </Routes></QueryClientProvider>
    </MemoryRouter>);
    expect(await screen.findByText("Ответ 1")).toBeInTheDocument();
    const cachedAt = queryClient.getQueryState(getFormQueryKey("form-1"))!.dataUpdatedAt;
    act(() => emitRealtimeChange("forms", {
      new: { id: "form-1", revision: "9007199254740993", responses_count: eventCount },
      commit_timestamp: new Date(cachedAt - 1000).toISOString(),
    }));
    await waitFor(() => expect(loadResponseRows).toHaveBeenCalledTimes(2));
    expect(queryClient.getQueryData(getFormQueryKey("form-1"))).toMatchObject({ responses_count: freshCount });
    expect(queryClient.getQueryState(getFormQueryKey("form-1"))!.dataUpdatedAt).toBeGreaterThanOrEqual(cachedAt);
    expect(getFormById).toHaveBeenCalledTimes(2);
  });

  it("forces a fresh responses fetch when opening with fresh cached data", async () => {
    const queryClient = createQueryClient();
    const form = {
      id: "form-1",
      title: "Форма обратной связи",
      created_at: "2026-04-08T10:00:00.000Z",
      is_public: true,
      author_id: "user-1",
      form_type: "anketa",
      form_reason: "plan",
      deadline_at: null,
      responses_count: 2,
      schema: {
        pages: [
          {
            elements: [{ type: "text", name: "name", title: "Имя" }],
          },
        ],
      },
    };

    queryClient.setQueryData(getFormQueryKey("form-1"), form);
    queryClient.setQueryData(
      getFormResponsesQueryKey("form-1", "page", 1, 50),
      { data: [
        {
          id: "response-1",
          form_id: "form-1",
          created_at: "2026-04-08T11:30:00.000Z",
          data: { name: "Анна" },
        },
      ], count: 1, totalPages: 1 },
    );

    getFormById.mockResolvedValue(form);
    loadResponseRows.mockResolvedValue([
      {
        id: "response-2",
        form_id: "form-1",
        created_at: "2026-04-08T11:31:00.000Z",
        data: { name: "Борис" },
      },
      {
        id: "response-1",
        form_id: "form-1",
        created_at: "2026-04-08T11:30:00.000Z",
        data: { name: "Анна" },
      },
    ]);

    render(
      <MemoryRouter initialEntries={["/dashboard/forms/form-1/responses"]}>
        <QueryClientProvider client={queryClient}>
          <Routes>
            <Route path="/dashboard/forms/:id/responses" element={<FormResponsesPage />} />
          </Routes>
        </QueryClientProvider>
      </MemoryRouter>,
    );

    expect(screen.getByText("Анна")).toBeInTheDocument();

    await waitFor(() => {
      expect(loadResponseRows).toHaveBeenCalledTimes(1);
    });

    expect(await screen.findByText("Борис")).toBeInTheDocument();
  });

  it("does not refresh responses when the browser tab becomes focused again", async () => {
    getFormById.mockResolvedValue({
      id: "form-1",
      title: "Форма обратной связи",
      created_at: "2026-04-08T10:00:00.000Z",
      is_public: true,
      author_id: "user-1",
      form_type: "anketa",
      form_reason: "plan",
      deadline_at: null,
      schema: {
        pages: [
          {
            elements: [{ type: "text", name: "name", title: "Имя" }],
          },
        ],
      },
    });

    loadResponseRows.mockResolvedValueOnce([
      {
        id: "response-1",
        form_id: "form-1",
        created_at: "2026-04-08T11:30:00.000Z",
        data: { name: "Анна" },
      },
    ]);

    render(
      <MemoryRouter initialEntries={["/dashboard/forms/form-1/responses"]}>
        <QueryClientProvider client={createQueryClient()}>
          <Routes>
            <Route path="/dashboard/forms/:id/responses" element={<FormResponsesPage />} />
          </Routes>
        </QueryClientProvider>
      </MemoryRouter>,
    );

    expect(await screen.findByText("Анна")).toBeInTheDocument();

    await waitFor(() => {
      expect(getFormById).toHaveBeenCalledTimes(1);
      expect(loadResponseRows).toHaveBeenCalledTimes(1);
    });

    await act(async () => {
      focusManager.setFocused(false);
      focusManager.setFocused(true);
    });

    await waitFor(() => {
      expect(getFormById).toHaveBeenCalledTimes(1);
      expect(loadResponseRows).toHaveBeenCalledTimes(1);
    }, { timeout: 100 });
  });

  it("opens the generated HTML responses page", async () => {
    getFormById.mockResolvedValue({
      id: "form-1",
      title: "Форма обратной связи",
      created_at: "2026-04-08T10:00:00.000Z",
      is_public: true,
      author_id: "user-1",
      form_type: "anketa",
      form_reason: "plan",
      deadline_at: null,
      schema: {
        pages: [
          {
            elements: [{ type: "text", name: "name", title: "Имя" }],
          },
        ],
      },
    });

    loadResponseRows.mockResolvedValue([
      {
        id: "response-1",
        form_id: "form-1",
        created_at: "2026-04-08T11:30:00.000Z",
        data: { name: "Анна" },
      },
    ]);

    render(
      <MemoryRouter initialEntries={["/dashboard/forms/form-1/responses"]}>
        <QueryClientProvider client={createQueryClient()}>
          <Routes>
            <Route path="/dashboard/forms/:id/responses" element={<FormResponsesPage />} />
            <Route path="/dashboard/forms/:id/responses/html" element={<h1>HTML ответы</h1>} />
          </Routes>
        </QueryClientProvider>
      </MemoryRouter>,
    );

    await userEvent.click(await screen.findByRole("button", { name: "HTML" }));

    expect(await screen.findByRole("heading", { name: "HTML ответы" })).toBeInTheDocument();
  });

  it("opens a filled readonly form preview from a response row", async () => {
    getFormById.mockResolvedValue({
      id: "form-1",
      title: "Форма обратной связи",
      created_at: "2026-04-08T10:00:00.000Z",
      is_public: true,
      author_id: "user-1",
      form_type: "anketa",
      form_reason: "plan",
      deadline_at: null,
      schema: {
        pages: [
          {
            elements: [
              { type: "text", name: "name", title: "Имя" },
              { type: "comment", name: "comment", title: "Комментарий" },
            ],
          },
        ],
      },
    });

    loadResponseRows.mockResolvedValue([
      {
        id: "response-1",
        form_id: "form-1",
        created_at: "2026-04-08T11:30:00.000Z",
        data: {
          name: "Анна",
          comment: "Готово",
        },
      },
    ]);

    render(
      <MemoryRouter initialEntries={["/dashboard/forms/form-1/responses"]}>
        <QueryClientProvider client={createQueryClient()}>
          <Routes>
            <Route path="/dashboard/forms/:id/responses" element={<FormResponsesPage />} />
          </Routes>
        </QueryClientProvider>
      </MemoryRouter>,
    );

    await userEvent.click(await screen.findByText("Анна"));

    const dialog = await screen.findByRole("dialog", { name: "Ответ Анна" });
    expect(within(dialog).queryByText("Ответ Анна")).not.toBeInTheDocument();
    expect(dialog.querySelector(".response-preview-body")).toHaveClass("response-preview-builder-palette");
    const renderer = await within(dialog).findByTestId("response-preview-renderer");
    expect(renderer).toHaveAttribute("data-form-id", "form-1");
    expect(renderer).toHaveAttribute("data-render-mode", "readonly-navigable");
    expect(renderer).toHaveAttribute("data-initial-data", JSON.stringify({ name: "Анна", comment: "Готово" }));
    expect(within(dialog).queryByRole("button", { name: /Завершить|Отправить/i })).not.toBeInTheDocument();
  });

  it("keeps a manually opened row when the linked response finishes loading", async () => {
    const linked = createResponse(2, "По ссылке");
    const manual = createResponse(1, "Строка");
    const deferred = createDeferred<SurveyResponse[]>();
    vi.spyOn(responseApi, "getAllResponsesByForm").mockImplementationOnce(() => deferred.promise);
    getFormById.mockResolvedValue({ id: "form-1", title: "Форма", author_id: "user-1",
      schema: { pages: [{ elements: [{ type: "text", name: "name", title: "Имя" }] }] } });
    loadResponseRows.mockResolvedValue([manual]);
    const client = createQueryClient();
    client.setQueryData(getFormResponsesQueryKey("form-1", "linked", linked.id), linked);
    render(<MemoryRouter initialEntries={["/dashboard/forms/form-1/responses?response=" + linked.id]}>
      <QueryClientProvider client={client}><Routes>
        <Route path="/dashboard/forms/:id/responses" element={<FormResponsesPage />} />
      </Routes></QueryClientProvider>
    </MemoryRouter>);
    await userEvent.click(await screen.findByText("Строка"));
    expect(screen.getByRole("dialog", { name: "Ответ Строка" })).toBeVisible();
    await act(async () => deferred.resolve([linked]));
    expect(screen.getByRole("dialog", { name: "Ответ Строка" })).toBeVisible();
    expect(screen.queryByRole("dialog", { name: "Ответ на форму" })).toBeNull();
  });

  it("opens response preview on the first page that contains answer data", async () => {
    getFormById.mockResolvedValue({
      id: "form-1",
      title: "Форма обратной связи",
      created_at: "2026-04-08T10:00:00.000Z",
      is_public: true,
      author_id: "user-1",
      form_type: "anketa",
      form_reason: "plan",
      deadline_at: null,
      schema: {
        title: "Форма обратной связи",
        pages: [
          { name: "page1", elements: [{ type: "text", name: "name", title: "Имя" }] },
          { name: "page2", elements: [{ type: "text", name: "comment", title: "Комментарий" }] },
        ],
      },
    });
    loadResponseRows.mockResolvedValue(
      [
        {
          id: "response-1",
          form_id: "form-1",
          created_at: "2026-04-08T11:30:00.000Z",
          data: {
            comment: "Ответ со второй страницы",
          },
        },
      ],
    );

    render(
      <MemoryRouter initialEntries={["/dashboard/forms/form-1/responses"]}>
        <QueryClientProvider client={createQueryClient()}>
          <Routes>
            <Route path="/dashboard/forms/:id/responses" element={<FormResponsesPage />} />
          </Routes>
        </QueryClientProvider>
      </MemoryRouter>,
    );

    await userEvent.click(await screen.findByText("Ответ со второй страницы"));

    const renderer = await screen.findByTestId("response-preview-renderer");

    expect(renderer).toHaveAttribute("data-initial-page-no", "1");
  });

  it("keeps rows available during automatic refresh", async () => {
    getFormById
      .mockResolvedValueOnce({
        id: "form-1",
        title: "Форма обратной связи",
        created_at: "2026-04-08T10:00:00.000Z",
        is_public: true,
        author_id: "user-1",
        form_type: "anketa",
        form_reason: "plan",
        deadline_at: null,
        schema: {
          pages: [
            {
              elements: [{ type: "text", name: "name", title: "Имя" }],
            },
          ],
        },
      });

    loadResponseRows.mockResolvedValueOnce([
      {
        id: "response-1",
        form_id: "form-1",
        created_at: "2026-04-08T11:30:00.000Z",
        data: { name: "Анна" },
      },
    ]);

    const formDeferred = createDeferred<unknown>();
    const responsesDeferred = createDeferred<SurveyResponse[]>();

    getFormById.mockImplementationOnce(() => formDeferred.promise);
    loadResponseRows.mockImplementationOnce(() => responsesDeferred.promise);

    render(
      <MemoryRouter initialEntries={["/dashboard/forms/form-1/responses"]}>
        <QueryClientProvider client={createQueryClient()}>
          <Routes>
            <Route path="/dashboard/forms/:id/responses" element={<FormResponsesPage />} />
          </Routes>
        </QueryClientProvider>
      </MemoryRouter>,
    );

    expect(await screen.findByText("Анна")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Обновить" })).not.toBeInTheDocument();
    act(() => emitRealtimeStatus("SUBSCRIBED"));
    await waitFor(() => expect(loadResponseRows).toHaveBeenCalledTimes(2));
    expect(screen.getByText("Анна")).toBeInTheDocument();

    formDeferred.resolve({
      id: "form-1",
      title: "Форма обратной связи",
      created_at: "2026-04-08T10:00:00.000Z",
      is_public: true,
      author_id: "user-1",
      form_type: "anketa",
      form_reason: "plan",
      deadline_at: null,
      schema: {
        pages: [
          {
            elements: [{ type: "text", name: "name", title: "Имя" }],
          },
        ],
      },
    });
    responsesDeferred.resolve([
      {
        id: "response-1",
        form_id: "form-1",
        created_at: "2026-04-08T11:30:00.000Z",
        data: { name: "Анна" },
      },
    ]);

    await waitFor(() => expect(screen.getByText("Анна")).toBeInTheDocument());
  });

  it("cycles global sorting and keeps selection and pinning as rows move between pages", async () => {
    const user = userEvent.setup();
    getFormById.mockResolvedValue({
      ...invitationForm,
      schema: { pages: [{ elements: [
        { type: "text", name: "name", title: "Имя" },
        { type: "text", inputType: "number", name: "score", title: "Баллы" },
      ] }] },
    });
    const responses = [
      { ...createResponse(1, "Анна"), data: { name: "Анна", score: "10" } },
      ...createFullResponsePage(1, 49).map((_, index) => createResponse(index + 2)),
      { ...createResponse(51, "Борис"), data: { name: "Борис", score: 2 } },
    ];
    loadResponseRows.mockResolvedValue(responses);
    render(<MemoryRouter initialEntries={["/forms/form-1/responses"]}>
      <QueryClientProvider client={createQueryClient()}><Routes>
        <Route path="/forms/:id/responses" element={<FormResponsesPage />} />
      </Routes></QueryClientProvider>
    </MemoryRouter>);

    const header = await screen.findByRole("columnheader", { name: "Баллы" });
    const firstResponse = () => screen.getAllByRole("row")[1];
    expect(within(firstResponse()).getByText("Анна")).toBeVisible();
    expect(screen.queryByText("Борис")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Закрепить заголовки" }));
    await user.click(screen.getByRole("checkbox", { name: "Выбрать Ответ Анна" }));

    const sortButton = within(header).getByRole("button", { name: "Баллы" });
    sortButton.focus();
    await user.keyboard("{Enter}");
    await waitFor(() => expect(header).toHaveAttribute("aria-sort", "ascending"));
    expect(within(firstResponse()).getByText("Борис")).toBeVisible();
    expect(within(firstResponse()).getByText("2")).toBeVisible();
    expect(screen.getByRole("checkbox", { name: "Выбрать Ответ Анна" })).toBeChecked();
    expect(screen.getByRole("button", { name: "Открепить заголовки" })).toHaveAttribute("aria-pressed", "true");

    await user.click(sortButton);
    expect(header).toHaveAttribute("aria-sort", "descending");
    expect(within(firstResponse()).getByText("Анна")).toBeVisible();
    expect(within(firstResponse()).getByText("10")).toBeVisible();
    await user.click(sortButton);
    expect(header).not.toHaveAttribute("aria-sort");
    expect(within(firstResponse()).getByText("Анна")).toBeVisible();
    expect(screen.queryByText("Борис")).not.toBeInTheDocument();

    const nameSort = screen.getByRole("button", { name: "Имя" });
    await user.click(nameSort);
    await user.click(nameSort);
    await waitFor(() => expect(screen.getByRole("columnheader", { name: "Имя" })).toHaveAttribute("aria-sort", "descending"));
    expect(screen.queryByText("Анна")).not.toBeInTheDocument();
    expect(screen.getByText("Выбрано: 1")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Далее" }));
    expect(await screen.findByRole("checkbox", { name: "Выбрать Ответ Анна" })).toBeChecked();
  });

  it("cancels a pending global sort when its direction is cleared", async () => {
    const user = userEvent.setup();
    const pendingResponses = createDeferred<SurveyResponse[]>();
    const fetchSort = vi.spyOn(responseApi, "getResponsesForSorting").mockReturnValue(pendingResponses.promise);
    getFormById.mockResolvedValue({
      ...invitationForm,
      schema: { pages: [{ elements: [{ type: "text", name: "name", title: "Имя" }] }] },
    });
    loadResponseRows.mockResolvedValue(createFullResponsePage(1, 60));
    render(<MemoryRouter initialEntries={["/forms/form-1/responses"]}>
      <QueryClientProvider client={createQueryClient()}><Routes>
        <Route path="/forms/:id/responses" element={<FormResponsesPage />} />
      </Routes></QueryClientProvider>
    </MemoryRouter>);

    try {
      const header = await screen.findByRole("button", { name: "Имя" });
      await user.click(header);
      expect(screen.getByRole("button", { name: "Далее" })).toBeDisabled();
      await user.click(header);
      await user.click(header);
      expect(fetchSort.mock.calls[0][1]?.aborted).toBe(true);
      await user.click(screen.getByRole("button", { name: "Далее" }));
      expect(await screen.findByText("Ответ 60")).toBeVisible();
    } finally {
      pendingResponses.resolve([]);
      fetchSort.mockRestore();
    }
  });

  it("clears the selection of a removed row when a regular page refreshes", async () => {
    const responses = createFullResponsePage(1, 60);
    getFormById.mockResolvedValue({
      ...invitationForm,
      schema: { pages: [{ elements: [{ type: "text", name: "name", title: "Имя" }] }] },
    });
    loadResponseRows.mockResolvedValue(responses);
    render(<MemoryRouter initialEntries={["/forms/form-1/responses"]}>
      <QueryClientProvider client={createQueryClient()}><Routes>
        <Route path="/forms/:id/responses" element={<FormResponsesPage />} />
      </Routes></QueryClientProvider>
    </MemoryRouter>);

    await userEvent.click(await screen.findByRole("checkbox", { name: "Выбрать Ответ Ответ 1" }));
    expect(screen.getByText("Выбрано: 1")).toBeVisible();
    loadResponseRows.mockResolvedValue(responses.slice(1));
    act(() => emitRealtimeChange("responses"));
    await screen.findByText("Ответов: 59");
    expect(screen.queryByText("Выбрано: 1")).not.toBeInTheDocument();
  });

  it("paginates 200 answers and exports a full snapshot only on demand", async () => {
    getFormById.mockResolvedValue({
      id: "form-1", title: "Полная форма", author_id: "user-1", form_type: "anketa", form_reason: "plan",
      schema: { pages: [{ elements: [{ type: "text", name: "name", title: "Имя" }] }] },
    });
    const responses = [...createFullResponsePage(1), ...createFullResponsePage(2)];
    loadResponseRows.mockResolvedValue(responses);
    exportToExcel.mockResolvedValue(undefined);
    render(<MemoryRouter initialEntries={["/forms/form-1/responses"]}>
      <QueryClientProvider client={createQueryClient()}><Routes>
        <Route path="/forms/:id/responses" element={<FormResponsesPage />} />
      </Routes></QueryClientProvider>
    </MemoryRouter>);
    expect(await screen.findByText("Ответ 50")).toBeInTheDocument();
    expect(screen.getByText("Ответ 1")).toBeInTheDocument();
    expect(screen.getByText("Ответов: 200")).toBeInTheDocument();
    expect(screen.getByLabelText("Страницы ответов")).toBeInTheDocument();
    expect(screen.queryByText("Ответ 200")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Далее" }));
    expect(await screen.findByText("Ответ 100")).toBeInTheDocument();
    expect(screen.queryByText("Ответ 1", { exact: true })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Скачать XLSX" }));
    await waitFor(() => expect(exportToExcel).toHaveBeenCalledOnce());
    expect(exportToExcel.mock.calls[0][0]).toHaveLength(200);
    expect(exportToExcel.mock.calls[0][0][0]).toMatchObject({ "answer:name": "Ответ 1" });
    expect(exportToExcel.mock.calls[0][0][199]).toMatchObject({ "answer:name": "Ответ 200" });
    await userEvent.click(screen.getByRole("button", { name: "Отчёт" }));
    const report = await screen.findByRole("dialog", { name: "Отчёт по ответам" });
    expect(within(report).getByText("Всего ответов").nextElementSibling).toHaveTextContent("200");
    expect(loadResponseRows).toHaveBeenCalledTimes(2);
  });

  it("discards an unfinished report when switching to another form", async () => {
    getFormById.mockImplementation(async (id: string) => ({
      ...invitationForm, id, title: id === "form-1" ? "Первая форма" : "Вторая форма",
      schema: { pages: [{ elements: [{ type: "text", name: "name", title: "Имя" }] }] },
    }));
    loadResponseRows.mockImplementation(async (id: string) => [{
      ...createResponse(1), form_id: id, data: { name: id === "form-1" ? "Первый ответ" : "Второй ответ" },
    }]);
    const deferred = createDeferred<SurveyResponse[]>();
    const all = vi.spyOn(responseApi, "getAllResponsesByForm").mockImplementationOnce(() => deferred.promise);
    try {
      render(<MemoryRouter initialEntries={["/forms/form-1/responses"]}>
        <QueryClientProvider client={createQueryClient()}>
          <Link to="/forms/form-2/responses">К другой форме</Link>
          <Routes><Route path="/forms/:id/responses" element={<FormResponsesPage />} /></Routes>
        </QueryClientProvider>
      </MemoryRouter>);
      await screen.findByText("Первый ответ");
      await userEvent.click(screen.getByRole("button", { name: "Отчёт" }));
      const signal = all.mock.calls[0]?.[1]?.signal;
      expect(signal).toBeInstanceOf(AbortSignal);
      await userEvent.click(screen.getByRole("link", { name: "К другой форме" }));
      await screen.findByText("Второй ответ");
      expect(signal?.aborted).toBe(true);
      await act(async () => { deferred.resolve([createResponse(1)]); });
      expect(screen.queryByRole("dialog", { name: "Отчёт по ответам" })).not.toBeInTheDocument();
    } finally {
      all.mockRestore();
    }
  });

  it("reconciles responses after the realtime subscription reconnects", async () => {
    getFormById.mockResolvedValue({ id: "form-1", author_id: "user-1", title: "Форма", schema: {
      pages: [{ elements: [{ type: "text", name: "name", title: "Имя" }] }],
    } });
    loadResponseRows.mockResolvedValue([createResponse(1)]);
    render(<MemoryRouter initialEntries={["/forms/form-1/responses"]}>
      <QueryClientProvider client={createQueryClient()}><Routes>
        <Route path="/forms/:id/responses" element={<FormResponsesPage />} />
      </Routes></QueryClientProvider>
    </MemoryRouter>);
    expect(await screen.findByText("Ответ 1")).toBeInTheDocument();
    loadResponseRows.mockResolvedValue([createResponse(1), createResponse(2)]);
    act(() => { emitRealtimeStatus("CHANNEL_ERROR"); emitRealtimeStatus("SUBSCRIBED"); });
    expect(await screen.findByText("Ответ 2")).toBeInTheDocument();
    expect(loadResponseRows).toHaveBeenCalledTimes(2);
  });

  it("deletes selected answers", async () => {
    getFormById.mockResolvedValue({
      id: "form-1",
      title: "Форма обратной связи",
      created_at: "2026-04-08T10:00:00.000Z",
      is_public: true,
      author_id: "user-1",
      form_type: "anketa",
      form_reason: "plan",
      deadline_at: null,
      responses_count: 1,
      schema: { pages: [{ elements: [{ type: "text", name: "name", title: "Имя" }] }] },
    });
    loadResponseRows.mockResolvedValue([createResponse(1, "Анна")]);
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);

    render(
      <MemoryRouter initialEntries={["/dashboard/forms/form-1/responses"]}>
        <QueryClientProvider client={createQueryClient()}>
          <Routes>
            <Route path="/dashboard/forms/:id/responses" element={<FormResponsesPage />} />
          </Routes>
        </QueryClientProvider>
      </MemoryRouter>,
    );

    expect(await screen.findByText("Анна")).toBeInTheDocument();
    const checkbox = screen.getByRole("checkbox", { name: "Выбрать Ответ Анна" });
    expect(checkbox.closest("tr")).not.toHaveAttribute("role", "button");
    expect(screen.getByRole("button", { name: "Открыть Ответ Анна" })).not.toContainElement(checkbox);
    await userEvent.click(screen.getByRole("checkbox", { name: "Выбрать Ответ Анна" }));
    expect(screen.getByText("Выбрано: 1")).toHaveClass("responses-selection-count");
    await userEvent.click(screen.getByRole("button", { name: "Удалить" }));

    await waitFor(() => {
      expect(deleteResponses).toHaveBeenCalledWith("form-1", ["response-1"]);
    });
    confirmSpy.mockRestore();
  });
});

it("resolves archived names in tables and XLSX while reporting only active selected types", async () => {
  const schema = { pages: [{ elements: [{ type: "organization", name: "org", title: "ОУ" }] }] };
  getFormById.mockResolvedValue({ id: "form-1", title: "Архив", author_id: "user-1", organization_types: ["school"], schema });
  loadResponseRows.mockResolvedValue([{ ...createResponse(1), data: { org: "archive-1" } }]);
  getOrganizations.mockResolvedValue([
    { id: "archive-1", organization_type: "school", number: "1", alias: "Архивная", is_archived: true },
    { id: "active-2", organization_type: "school", number: "2", alias: "Действующая", is_archived: false },
    { id: "garden-3", organization_type: "kindergarten", number: "3", alias: "Сад", is_archived: false },
  ]);
  render(<MemoryRouter initialEntries={["/dashboard/forms/form-1/responses"]}>
    <QueryClientProvider client={createQueryClient()}><Routes>
      <Route path="/dashboard/forms/:id/responses" element={<FormResponsesPage />} />
    </Routes></QueryClientProvider>
  </MemoryRouter>);
  expect(await screen.findByText("Архивная 1")).toBeInTheDocument();
  expect(getOrganizations).toHaveBeenCalledWith(undefined, expect.any(AbortSignal), true);
  await userEvent.click(screen.getByRole("button", { name: "Скачать XLSX" }));
  await waitFor(() => expect(exportToExcel).toHaveBeenCalledWith(
    [expect.objectContaining({ "answer:org": "Архивная 1" })],
    "ответы-Архив", "Ответы", expect.any(Array),
  ));
  await userEvent.click(screen.getByRole("button", { name: "Отчёт" }));
  const dialog = await screen.findByRole("dialog");
  await userEvent.click(within(dialog).getByRole("tab", { name: "Учёт сдавших" }));
  expect(within(dialog).getByText("Действующая 2")).toBeInTheDocument();
  expect(within(dialog).queryByText("Архивная 1")).not.toBeInTheDocument();
  expect(within(dialog).queryByText("Сад 3")).not.toBeInTheDocument();
});
