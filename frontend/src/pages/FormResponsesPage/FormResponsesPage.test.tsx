import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SurveyResponse } from "../../entities/response/types";
import FormResponsesPage from "./FormResponsesPage";

const { getFormById, getResponsesByForm, exportToExcel, showToast } = vi.hoisted(() => ({
  getFormById: vi.fn(),
  getResponsesByForm: vi.fn(),
  exportToExcel: vi.fn(),
  showToast: vi.fn(),
}));

const { createRealtimeChannel, removeRealtimeChannel, emitRealtimeChange, resetRealtimeChannel } = vi.hoisted(() => {
  const changeHandlers: Array<() => void> = [];
  const channel = {
    on: vi.fn((_event: string, _config: unknown, callback: () => void) => {
      changeHandlers.push(callback);
      return channel;
    }),
    subscribe: vi.fn(() => channel),
  };
  const createRealtimeChannel = vi.fn(() => channel);
  const removeRealtimeChannel = vi.fn(() => Promise.resolve("ok"));

  return {
    createRealtimeChannel,
    removeRealtimeChannel,
    emitRealtimeChange: () => {
      for (const handler of changeHandlers) {
        handler();
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
  getResponsesByForm,
}));

vi.mock("../../shared/lib/export", () => ({
  exportToExcel,
}));

vi.mock("../../shared/api", () => ({
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

vi.mock("../../widgets/SurveyRenderer/SurveyRenderer", () => ({
  SurveyRenderer: ({
    formId,
    initialData,
    isPreview,
    schema,
  }: {
    formId: string;
    initialData?: Record<string, unknown>;
    isPreview?: boolean;
    schema: { title?: string };
  }) => (
    <div
      data-testid="response-preview-renderer"
      data-form-id={formId}
      data-initial-data={JSON.stringify(initialData ?? {})}
      data-preview={String(Boolean(isPreview))}
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

function readAppCss() {
  return readFileSync(join(process.cwd(), "src/app.css"), "utf8");
}

describe("FormResponsesPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
    expect(screen.getByRole("button", { name: "XLSX" })).toBeInTheDocument();
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

    await userEvent.click(screen.getByRole("button", { name: "XLSX" }));

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

  it("uses a dark gradient style with a white icon for the HTML preview button", () => {
    const css = readAppCss();

    expect(css).toMatch(/button\.responses-export-button\.responses-html-button\s*\{[^}]*border-color:\s*rgba\(39,\s*39,\s*42,\s*0\.52\);[^}]*background:\s*linear-gradient\(180deg,\s*#3f3f46,\s*#27272a\);[^}]*color:\s*#ffffff;/);
    expect(css).toMatch(/button\.responses-export-button\.responses-html-button:hover,\s*button\.responses-export-button\.responses-html-button:focus-visible\s*\{[^}]*border-color:\s*rgba\(63,\s*63,\s*70,\s*0\.72\);[^}]*background:\s*linear-gradient\(180deg,\s*#52525b,\s*#3f3f46\);[^}]*color:\s*#ffffff;/);
    expect(css).toMatch(/\.responses-html-button\s+\.toolbar-icon\s*\{[^}]*filter:\s*brightness\(0\)\s*invert\(1\);/);
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
    expect(dialog.querySelector(".response-preview-body")).toHaveClass("response-preview-builder-palette");
    const renderer = within(dialog).getByTestId("response-preview-renderer");
    expect(renderer).toHaveAttribute("data-form-id", "form-1");
    expect(renderer).toHaveAttribute("data-preview", "true");
    expect(renderer).toHaveAttribute("data-initial-data", JSON.stringify({ name: "Анна", comment: "Готово" }));
    expect(within(dialog).queryByRole("button", { name: /Завершить|Отправить/i })).not.toBeInTheDocument();
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
    expect(getResponsesByForm).toHaveBeenCalledWith("form-1", { page: 1, pageSize: 100 });
    expect(screen.queryByLabelText("Пагинация ответов")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Следующая" })).not.toBeInTheDocument();
  });

  it("fetches remaining response pages only when exporting xlsx", async () => {
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
        count: 2,
        page: options?.page ?? 1,
        pageSize: 100,
        totalPages: 2,
      }),
    );

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

    expect(await screen.findByText("Анна")).toBeInTheDocument();
    getResponsesByForm.mockClear();

    await userEvent.click(screen.getByRole("button", { name: "XLSX" }));

    await waitFor(() => {
      expect(getResponsesByForm).toHaveBeenCalledWith("form-1", { page: 2, pageSize: 100 });
      expect(exportToExcel).toHaveBeenCalledWith(
        [
          expect.objectContaining({
            Имя: "Анна",
          }),
          expect.objectContaining({
            Имя: "Борис",
          }),
        ],
        "ответы-Форма обратной связи",
      );
    });
  });
});
