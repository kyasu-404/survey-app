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

  it("keeps wide response tables scrolling inside the table content only", () => {
    const css = readAppCss();

    expect(css).toMatch(/\.app-main\s*\{[^}]*min-width:\s*0;/);
    expect(css).toMatch(/\.dashboard-page\s*\{[^}]*min-width:\s*0;/);
    expect(css).toMatch(/\.responses-page-card\s*\{[^}]*min-width:\s*0;/);
    expect(css).toMatch(/\.responses-page-table-shell\s*\{[^}]*max-width:\s*100%;/);
    expect(css).toMatch(/\.responses-page-table-shell\s+\.responses-table\s*\{[^}]*width:\s*max-content;[^}]*min-width:\s*100%;/);
  });

  it("renders the form title, responses table, and export action", async () => {
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
    expect(screen.getByRole("button", { name: "Выгрузить страницу XLSX" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "HTML" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Обновить" })).toBeInTheDocument();
    expect(await screen.findByText("Анна")).toBeInTheDocument();
    expect(container.querySelector(".responses-page-header-copy")).toBeInTheDocument();
    expect(container.querySelector(".responses-export-button .toolbar-icon")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Выгрузить страницу XLSX" }));

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

    await userEvent.click(refreshButton);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Обновляется..." })).toBeDisabled();
    });

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
      expect(screen.getByRole("button", { name: "Обновить" })).not.toBeDisabled();
    });
  });

  it("loads responses by page and moves through server-side pagination", async () => {
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
        pageSize: 50,
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
    expect(getResponsesByForm).toHaveBeenCalledWith("form-1", { page: 1, pageSize: 50 });
    expect(screen.getByText("Показаны 1-50 из 75")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Следующая" }));

    expect(await screen.findByText("Борис")).toBeInTheDocument();
    expect(getResponsesByForm).toHaveBeenLastCalledWith("form-1", { page: 2, pageSize: 50 });
    expect(screen.getByText("Показаны 51-75 из 75")).toBeInTheDocument();
  });
});
