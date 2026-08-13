import { focusManager, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SurveyResponse } from "../../entities/response/types";
import { getFormQueryKey, getFormResponsesQueryKey } from "../../entities/survey/model/queryKeys";
import FormResponsesPage from "./FormResponsesPage";

const { deleteResponses, getFormById, getResponsesByForm, exportToExcel, showToast } = vi.hoisted(() => ({
  deleteResponses: vi.fn(),
  getFormById: vi.fn(),
  getResponsesByForm: vi.fn(),
  exportToExcel: vi.fn(),
  showToast: vi.fn(),
}));

const { createRealtimeChannel, removeRealtimeChannel, emitRealtimeChange, resetRealtimeChannel } = vi.hoisted(() => {
  type RealtimeHandler = {
    config: { table?: string };
    callback: (payload?: unknown) => void;
  };
  const changeHandlers: RealtimeHandler[] = [];
  const channel = {
    on: vi.fn((_event: string, config: unknown, callback: (payload?: unknown) => void) => {
      changeHandlers.push({
        config: (config ?? {}) as { table?: string },
        callback,
      });
      return channel;
    }),
    subscribe: vi.fn(() => channel),
  };
  const createRealtimeChannel = vi.fn(() => channel);
  const removeRealtimeChannel = vi.fn(() => Promise.resolve("ok"));

  return {
    createRealtimeChannel,
    removeRealtimeChannel,
    emitRealtimeChange: (table?: string) => {
      for (const handler of changeHandlers) {
        if (!table || handler.config.table === table) {
          handler.callback();
        }
      }
    },
    resetRealtimeChannel: () => {
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

vi.mock("../../entities/response/api", () => ({
  deleteResponses,
  getResponsesByForm,
}));

vi.mock("../../shared/lib/export", () => ({
  exportToExcel,
}));

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

vi.mock("../../widgets/SurveyRenderer/SurveyRenderer", () => ({
  SurveyRenderer: ({
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

function createResponsesPage(data: SurveyResponse[], overrides: Partial<{
  count: number;
  page: number;
  pageSize: number;
  totalPages: number;
}> = {}) {
  return {
    data,
    count: data.length,
    page: 1,
    pageSize: 50,
    totalPages: 1,
    ...overrides,
  };
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

function readAppCss() {
  return readFileSync(join(process.cwd(), "src/app.css"), "utf8");
}

describe("FormResponsesPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    deleteResponses.mockResolvedValue(undefined);
    resetRealtimeChannel();
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
      /\.responses-table th,\s*\.responses-table td\s*\{[^}]*white-space:\s*normal;[^}]*overflow-wrap:\s*anywhere;[^}]*word-break:\s*break-word;[^}]*max-width:\s*min\(28rem,\s*40vw\);/s,
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

    getResponsesByForm.mockResolvedValue(createResponsesPage(responses));

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
    expect(screen.getByRole("button", { name: "Отчёт" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "HTML" })).toBeInTheDocument();
    const refreshButton = screen.getByRole("button", { name: "Обновить" });
    expect(refreshButton).toBeInTheDocument();
    expect(refreshButton.querySelector("img.toolbar-icon")).toBeInTheDocument();
    expect(refreshButton.querySelector(".inline-spinner")).not.toBeInTheDocument();
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
            Имя: "Анна",
          }),
        ],
        "ответы-Форма обратной связи",
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

    expect(css).toMatch(/button\.responses-export-button\s*\{[^}]*background:\s*linear-gradient\(180deg,\s*#27272a,\s*#111111\);[^}]*color:\s*#ffffff;/);
    expect(css).toMatch(/button\.responses-export-button:hover,\s*button\.responses-export-button:focus-visible\s*\{[^}]*background:\s*linear-gradient\(180deg,\s*#3f3f46,\s*#18181b\);[^}]*color:\s*#ffffff;/);
    expect(css).toMatch(/\.responses-export-button\s+\.toolbar-icon\s*\{[^}]*filter:\s*brightness\(0\)\s*invert\(1\);/);
  });

  it("makes the HTML export button match the XLSX button", () => {
    const css = readAppCss();

    expect(css).toMatch(/button\.responses-export-button\.responses-html-button\s*\{[^}]*background:\s*linear-gradient\(180deg,\s*#27272a,\s*#111111\);[^}]*color:\s*#ffffff;/);
    expect(css).toMatch(/button\.responses-export-button\.responses-html-button:hover,\s*button\.responses-export-button\.responses-html-button:focus-visible\s*\{[^}]*background:\s*linear-gradient\(180deg,\s*#3f3f46,\s*#18181b\);[^}]*color:\s*#ffffff;/);
    expect(css).toMatch(/\.responses-html-button\s+\.toolbar-icon\s*\{[^}]*filter:\s*brightness\(0\)\s*invert\(1\);/);
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

    getResponsesByForm
      .mockResolvedValueOnce(createResponsesPage([
        {
          id: "response-1",
          form_id: "form-1",
          created_at: "2026-04-08T11:30:00.000Z",
          data: { name: "Анна" },
        },
      ]))
      .mockResolvedValueOnce(createResponsesPage([
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
      ], { count: 2 }));

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

    emitRealtimeChange();

    await waitFor(() => {
      expect(getResponsesByForm).toHaveBeenCalledTimes(2);
    });

    expect(await screen.findByText("Борис")).toBeInTheDocument();
  });

  it("refreshes response rows when only the form counter realtime update is delivered", async () => {
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
      schema: {
        pages: [
          {
            elements: [{ type: "text", name: "name", title: "Имя" }],
          },
        ],
      },
    };

    getFormById
      .mockResolvedValueOnce(baseForm)
      .mockResolvedValueOnce({
        ...baseForm,
        responses_count: 2,
      });

    getResponsesByForm
      .mockResolvedValueOnce(createResponsesPage([
        {
          id: "response-1",
          form_id: "form-1",
          created_at: "2026-04-08T11:30:00.000Z",
          data: { name: "Анна" },
        },
      ]))
      .mockResolvedValueOnce(createResponsesPage([
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
      ], { count: 2 }));

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

    emitRealtimeChange("forms");

    await waitFor(() => {
      expect(getResponsesByForm).toHaveBeenCalledTimes(2);
    });

    expect(await screen.findByText("Борис")).toBeInTheDocument();
    expect(screen.getByText("Ответов: 2")).toBeInTheDocument();
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
      getFormResponsesQueryKey("form-1", "page", 1, 100),
      createResponsesPage([
        {
          id: "response-1",
          form_id: "form-1",
          created_at: "2026-04-08T11:30:00.000Z",
          data: { name: "Анна" },
        },
      ], { pageSize: 100 }),
    );

    getFormById.mockResolvedValue(form);
    getResponsesByForm.mockResolvedValue(createResponsesPage([
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
    ], { count: 2, pageSize: 100 }));

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
      expect(getResponsesByForm).toHaveBeenCalledTimes(1);
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

    getResponsesByForm.mockResolvedValueOnce(createResponsesPage([
      {
        id: "response-1",
        form_id: "form-1",
        created_at: "2026-04-08T11:30:00.000Z",
        data: { name: "Анна" },
      },
    ]));

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
      expect(getResponsesByForm).toHaveBeenCalledTimes(1);
    });

    await act(async () => {
      focusManager.setFocused(false);
      focusManager.setFocused(true);
    });

    await waitFor(() => {
      expect(getFormById).toHaveBeenCalledTimes(1);
      expect(getResponsesByForm).toHaveBeenCalledTimes(1);
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

    getResponsesByForm.mockResolvedValue(createResponsesPage([
      {
        id: "response-1",
        form_id: "form-1",
        created_at: "2026-04-08T11:30:00.000Z",
        data: { name: "Анна" },
      },
    ]));

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

    getResponsesByForm.mockResolvedValue(createResponsesPage([
      {
        id: "response-1",
        form_id: "form-1",
        created_at: "2026-04-08T11:30:00.000Z",
        data: {
          name: "Анна",
          comment: "Готово",
        },
      },
    ]));

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
    getResponsesByForm.mockResolvedValue(
      createResponsesPage([
        {
          id: "response-1",
          form_id: "form-1",
          created_at: "2026-04-08T11:30:00.000Z",
          data: {
            comment: "Ответ со второй страницы",
          },
        },
      ]),
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

  it("disables the refresh button while responses are being updated", async () => {
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

    getResponsesByForm.mockResolvedValueOnce(createResponsesPage([
      {
        id: "response-1",
        form_id: "form-1",
        created_at: "2026-04-08T11:30:00.000Z",
        data: { name: "Анна" },
      },
    ]));

    const formDeferred = createDeferred<unknown>();
    const responsesDeferred = createDeferred<ReturnType<typeof createResponsesPage>>();

    getFormById.mockImplementationOnce(() => formDeferred.promise);
    getResponsesByForm.mockImplementationOnce(() => responsesDeferred.promise);

    render(
      <MemoryRouter initialEntries={["/dashboard/forms/form-1/responses"]}>
        <QueryClientProvider client={createQueryClient()}>
          <Routes>
            <Route path="/dashboard/forms/:id/responses" element={<FormResponsesPage />} />
          </Routes>
        </QueryClientProvider>
      </MemoryRouter>,
    );

    const refreshButton = await screen.findByRole("button", { name: "Обновить" });
    expect(screen.getByText(/Обновлено \d{2}:\d{2}:\d{2}/)).toBeInTheDocument();

    await userEvent.click(refreshButton);

    await waitFor(() => {
      const refreshingButton = screen.getByRole("button", { name: "Обновляется..." });
      expect(refreshingButton).toBeDisabled();
      expect(refreshingButton.querySelector(".inline-spinner")).toBeInTheDocument();
      expect(refreshingButton.querySelector("img.toolbar-icon")).not.toBeInTheDocument();
    });
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
    responsesDeferred.resolve(createResponsesPage([
      {
        id: "response-1",
        form_id: "form-1",
        created_at: "2026-04-08T11:30:00.000Z",
        data: { name: "Анна" },
      },
    ]));

    await waitFor(() => {
      const refreshButton = screen.getByRole("button", { name: "Обновить" });
      expect(refreshButton).not.toBeDisabled();
      expect(refreshButton.querySelector("img.toolbar-icon")).toBeInTheDocument();
      expect(refreshButton.querySelector(".inline-spinner")).not.toBeInTheDocument();
    });
  });

  it("renders only the first response page on initial load even when more pages exist", async () => {
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

    getResponsesByForm.mockImplementation((_formId: string, options?: { page?: number }) =>
      Promise.resolve({
        data: [
          {
            id: `response-page-${options?.page ?? 1}`,
            form_id: "form-1",
            created_at: "2026-04-08T11:30:00.000Z",
            data: { name: options?.page === 2 ? "Борис" : "Анна" },
          },
        ],
        count: 75,
        page: options?.page ?? 1,
        pageSize: 100,
        totalPages: 2,
      }),
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

    expect(await screen.findByText("Анна")).toBeInTheDocument();
    expect(screen.queryByText("Борис")).not.toBeInTheDocument();
    expect(getResponsesByForm).toHaveBeenCalledTimes(1);
    expect(getResponsesByForm).toHaveBeenCalledWith(
      "form-1",
      expect.objectContaining({ page: 1, pageSize: 100, signal: expect.any(Object) }),
    );
    expect(screen.queryByLabelText("Пагинация ответов")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Следующая" })).not.toBeInTheDocument();
  });

  it("fetches response export pages sequentially instead of starting every remaining page at once", async () => {
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

    const page2 = createDeferred<ReturnType<typeof createResponsesPage>>();
    const page3 = createDeferred<ReturnType<typeof createResponsesPage>>();
    getResponsesByForm.mockImplementation((_formId: string, options?: { page?: number }) => {
      const page = options?.page ?? 1;

      if (page === 1) {
        return Promise.resolve(createResponsesPage(createFullResponsePage(1), {
          count: 300,
          page: 1,
          pageSize: 100,
          totalPages: 3,
        }));
      }

      if (page === 2) {
        return page2.promise;
      }

      if (page === 3) {
        return page3.promise;
      }

      return Promise.resolve(createResponsesPage([], {
        count: 300,
        page,
        pageSize: 100,
        totalPages: 3,
      }));
    });

    exportToExcel.mockResolvedValue(undefined);

    render(
      <MemoryRouter initialEntries={["/dashboard/forms/form-1/responses"]}>
        <QueryClientProvider client={createQueryClient()}>
          <Routes>
            <Route path="/dashboard/forms/:id/responses" element={<FormResponsesPage />} />
          </Routes>
        </QueryClientProvider>
      </MemoryRouter>,
    );

    expect(await screen.findByText("Ответ 1")).toBeInTheDocument();
    getResponsesByForm.mockClear();

    await userEvent.click(screen.getByRole("button", { name: "Скачать XLSX" }));

    await waitFor(() => {
      expect(getResponsesByForm).toHaveBeenCalledWith("form-1", { page: 2, pageSize: 100 });
    });
    expect(getResponsesByForm).not.toHaveBeenCalledWith("form-1", { page: 3, pageSize: 100 });
    expect(exportToExcel).not.toHaveBeenCalled();

    page2.resolve(createResponsesPage(createFullResponsePage(2), {
      count: 300,
      page: 2,
      pageSize: 100,
      totalPages: 3,
    }));

    await waitFor(() => {
      expect(getResponsesByForm).toHaveBeenCalledWith("form-1", { page: 3, pageSize: 100 });
    });

    page3.resolve(createResponsesPage([createResponse(201, "Финальный ответ")], {
      count: 300,
      page: 3,
      pageSize: 100,
      totalPages: 3,
    }));

    await waitFor(() => {
      expect(exportToExcel).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            Имя: "Ответ 1",
          }),
          expect.objectContaining({
            Имя: "Финальный ответ",
          }),
        ]),
        "ответы-Форма обратной связи",
      );
    });
  });

  it("continues xlsx export after a full first page even when planned count underestimates total pages", async () => {
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

    getResponsesByForm.mockImplementation((_formId: string, options?: { page?: number }) => {
      const page = options?.page ?? 1;

      if (page === 1) {
        return Promise.resolve(createResponsesPage(createFullResponsePage(1), {
          count: 50,
          page: 1,
          pageSize: 100,
          totalPages: 1,
        }));
      }

      return Promise.resolve(createResponsesPage([createResponse(101, "Борис")], {
        count: 50,
        page,
        pageSize: 100,
        totalPages: 1,
      }));
    });

    exportToExcel.mockResolvedValue(undefined);

    render(
      <MemoryRouter initialEntries={["/dashboard/forms/form-1/responses"]}>
        <QueryClientProvider client={createQueryClient()}>
          <Routes>
            <Route path="/dashboard/forms/:id/responses" element={<FormResponsesPage />} />
          </Routes>
        </QueryClientProvider>
      </MemoryRouter>,
    );

    expect(await screen.findByText("Ответ 1")).toBeInTheDocument();
    getResponsesByForm.mockClear();

    await userEvent.click(screen.getByRole("button", { name: "Скачать XLSX" }));

    await waitFor(() => {
      expect(getResponsesByForm).toHaveBeenCalledWith("form-1", { page: 2, pageSize: 100 });
      expect(exportToExcel).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            Имя: "Ответ 1",
          }),
          expect.objectContaining({
            Имя: "Борис",
          }),
        ]),
        "ответы-Форма обратной связи",
      );
    });
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
    getResponsesByForm.mockResolvedValue(createResponsesPage([createResponse(1, "Анна")]));
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
    await userEvent.click(screen.getByRole("checkbox", { name: "Выбрать Ответ Анна" }));
    expect(screen.getByText("Выбрано: 1")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Удалить" }));

    await waitFor(() => {
      expect(deleteResponses).toHaveBeenCalledWith("form-1", ["response-1"]);
    });
    confirmSpy.mockRestore();
  });
});
