import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { routes } from "../../app/routes";
import DashboardPage from "./DashboardPage";

const { showToast, navigate, getForms, cloneForm, getResponsesByForm, exportToExcel } = vi.hoisted(() => ({
  showToast: vi.fn(),
  navigate: vi.fn(),
  getForms: vi.fn(),
  cloneForm: vi.fn(),
  getResponsesByForm: vi.fn(),
  exportToExcel: vi.fn(),
}));

vi.mock("../../app/providers/AuthProvider", () => ({
  useAuth: () => ({
    user: { id: "user-1" },
    loading: false,
  }),
}));

vi.mock("../../app/providers/ToastProvider", () => ({
  useToast: () => ({
    showToast,
  }),
}));

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");

  return {
    ...actual,
    useNavigate: () => navigate,
  };
});

vi.mock("../../entities/survey/api/surveysApi", () => ({
  getForms,
  cloneForm,
  renameForm: vi.fn(),
  removeForm: vi.fn(),
  changeFormStatus: vi.fn(),
  setFormDeadline: vi.fn(),
}));

vi.mock("../../entities/response/api", () => ({
  getResponsesByForm,
}));

vi.mock("../../shared/lib/browser", () => ({
  copyTextToClipboard: vi.fn(),
}));

vi.mock("../../shared/lib/export", () => ({
  exportToExcel,
}));

describe("DashboardPage", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("renders forms as a single table with icon actions and responses page link", async () => {
    getForms.mockResolvedValue([
      {
        id: "form-1",
        title: "Форма обратной связи",
        created_at: "2026-04-08T10:00:00.000Z",
        is_public: true,
        author_id: "user-1",
        author_name: "Иван Петров",
        author_email: "ivan@example.com",
        form_type: "anketa",
        form_reason: "plan",
        deadline_at: "2026-04-10T15:00:00.000Z",
        responses_count: 12,
        schema: { pages: [] },
      },
      {
        id: "form-2",
        title: "Закрытая форма",
        created_at: "2026-04-07T10:00:00.000Z",
        is_public: false,
        author_id: "user-2",
        author_name: "Мария Иванова",
        author_email: "maria@example.com",
        form_type: "anketa",
        form_reason: "plan",
        deadline_at: null,
        responses_count: 0,
        schema: { pages: [] },
      },
    ]);
    cloneForm.mockResolvedValue({ id: "form-2" });
    getResponsesByForm.mockResolvedValue([
      {
        id: "response-1",
        created_at: "2026-04-08T12:00:00.000Z",
        data: {
          email: "reader@example.com",
        },
      },
    ]);

    const queryClient = new QueryClient({
      defaultOptions: {
        mutations: { retry: false },
        queries: { retry: false },
      },
    });

    render(
      <MemoryRouter>
        <QueryClientProvider client={queryClient}>
          <DashboardPage viewMode="all" />
        </QueryClientProvider>
      </MemoryRouter>,
    );

    const workspaceTable = await screen.findByRole("table");
    const feedbackCell = await within(workspaceTable).findByText("Форма обратной связи");
    const closedCell = await within(workspaceTable).findByText("Закрытая форма");
    const feedbackRow = feedbackCell.closest("tr");
    const closedRow = closedCell.closest("tr");

    expect(feedbackRow).not.toBeNull();
    expect(closedRow).not.toBeNull();

    expect(await screen.findByRole("heading", { name: "Командный центр форм" })).toBeInTheDocument();
    expect(screen.getByText("Ближайшие дедлайны")).toBeInTheDocument();
    expect(screen.getByText("Недавние формы")).toBeInTheDocument();
    expect(screen.getByText("Всего форм")).toBeInTheDocument();
    expect(screen.getAllByText("Активные")[0]).toBeInTheDocument();
    expect(screen.getByText("С дедлайном")).toBeInTheDocument();
    expect(feedbackCell).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Показать статистику" })).toBeInTheDocument();

    const responsesLink = within(feedbackRow!).getByRole("link", { name: "Показать ответы" });
    expect(responsesLink).toHaveAttribute("href", routes.formResponses("form-1"));

    await userEvent.click(within(feedbackRow!).getByText("Форма обратной связи"));
    expect(navigate).toHaveBeenCalledWith(`${routes.survey("form-1")}?mode=preview`);

    await userEvent.click(screen.getByRole("button", { name: "Действия с формой" }));
    expect(screen.getAllByRole("button", { name: "Дублировать" })).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: "Выгрузить в XLSX" })).toHaveLength(2);

    expect(within(closedRow!).getByRole("button", { name: "Выгрузить в XLSX" })).toBeInTheDocument();
    await userEvent.click(within(closedRow!).getByRole("button", { name: "Выгрузить в XLSX" }));
    await waitFor(() => {
      expect(getResponsesByForm).toHaveBeenCalledWith("form-2");
    });
    await waitFor(() => {
      expect(exportToExcel).toHaveBeenCalledWith(
        [
          expect.objectContaining({
            "Дата ответа": expect.any(String),
            email: "reader@example.com",
          }),
        ],
        "ответы-Закрытая форма",
      );
    });

    await userEvent.click(screen.getByRole("button", { name: "Показать статистику" }));
    expect(screen.getByText("Всего форм: 2")).toBeInTheDocument();
    expect(screen.getByText("Активных: 1")).toBeInTheDocument();
    expect(screen.getByText("С дедлайном: 1")).toBeInTheDocument();

    await userEvent.selectOptions(screen.getByLabelText("Статус"), "closed");
    expect(within(workspaceTable).getByText("Закрытая форма")).toBeInTheDocument();
    expect(within(workspaceTable).queryByText("Форма обратной связи")).not.toBeInTheDocument();
  });

  it("shows only actionable active forms in the nearest deadlines module", async () => {
    getForms.mockResolvedValue([
      {
        id: "form-1",
        title: "Публичный дедлайн",
        created_at: "2026-04-08T10:00:00.000Z",
        is_public: true,
        author_id: "user-1",
        author_name: "Иван Петров",
        author_email: "ivan@example.com",
        form_type: "anketa",
        form_reason: "plan",
        deadline_at: "2026-04-10T15:00:00.000Z",
        responses_count: 2,
        schema: { pages: [] },
      },
      {
        id: "form-2",
        title: "Непубличный дедлайн",
        created_at: "2026-04-08T11:00:00.000Z",
        is_public: false,
        author_id: "user-2",
        author_name: "Мария Иванова",
        author_email: "maria@example.com",
        form_type: "anketa",
        form_reason: "plan",
        deadline_at: "2026-04-09T15:00:00.000Z",
        responses_count: 0,
        schema: { pages: [] },
      },
      {
        id: "form-3",
        title: "Истекший дедлайн",
        created_at: "2026-04-08T12:00:00.000Z",
        is_public: true,
        author_id: "user-3",
        author_name: "Елена Сидорова",
        author_email: "elena@example.com",
        form_type: "anketa",
        form_reason: "plan",
        deadline_at: "2026-04-01T12:00:00.000Z",
        responses_count: 1,
        schema: { pages: [] },
      },
    ]);

    const queryClient = new QueryClient({
      defaultOptions: {
        mutations: { retry: false },
        queries: { retry: false },
      },
    });

    render(
      <MemoryRouter>
        <QueryClientProvider client={queryClient}>
          <DashboardPage viewMode="all" />
        </QueryClientProvider>
      </MemoryRouter>,
    );

    const deadlineModule = (await screen.findByRole("heading", { name: "Ближайшие дедлайны" })).closest("section");

    expect(deadlineModule).not.toBeNull();
    expect(await within(deadlineModule!).findByText("Публичный дедлайн")).toBeInTheDocument();
    expect(within(deadlineModule!).queryByText("Непубличный дедлайн")).not.toBeInTheDocument();
    expect(within(deadlineModule!).queryByText("Истекший дедлайн")).not.toBeInTheDocument();
  });

  it("automatically hides expired deadline labels and treats the form as closed", async () => {
    vi.useFakeTimers();

    const now = new Date("2026-04-08T12:00:00.000Z");
    vi.setSystemTime(now);

    const deadlineAt = new Date(now.getTime() + 500).toISOString();

    getForms.mockResolvedValue([
      {
        id: "form-1",
        title: "Форма с дедлайном",
        created_at: new Date(now - 60_000).toISOString(),
        is_public: true,
        author_id: "user-1",
        author_name: "Иван Петров",
        author_email: "ivan@example.com",
        form_type: "anketa",
        form_reason: "plan",
        deadline_at: deadlineAt,
        responses_count: 2,
        schema: { pages: [] },
      },
    ]);

    const queryClient = new QueryClient({
      defaultOptions: {
        mutations: { retry: false },
        queries: { retry: false },
      },
    });

    render(
      <MemoryRouter>
        <QueryClientProvider client={queryClient}>
          <DashboardPage viewMode="all" />
        </QueryClientProvider>
      </MemoryRouter>,
    );

    await act(async () => {
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(screen.getByRole("button", { name: "Активна" })).toBeInTheDocument();
    expect(screen.getAllByText("Форма с дедлайном")[0]).toBeInTheDocument();
    expect(screen.getByText(/Дедлайн:/)).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(501);
    });

    expect(screen.getByRole("button", { name: "Закрыта" })).toBeInTheDocument();

    expect(screen.queryByText(/Дедлайн:/)).not.toBeInTheDocument();

    expect(screen.queryByText("Активна")).not.toBeInTheDocument();
  });

  it("re-enables action buttons after mutation even when cache invalidation hangs", async () => {
    getForms.mockResolvedValue([
      {
        id: "form-1",
        title: "Test form",
        created_at: "2026-04-08T10:00:00.000Z",
        is_public: true,
        author_id: "user-2",
        author_name: "Another User",
        author_email: "another@example.com",
        form_type: "anketa",
        form_reason: "plan",
        deadline_at: null,
        responses_count: 0,
        schema: { pages: [] },
      },
    ]);
    cloneForm.mockResolvedValue({ id: "form-2" });

    const queryClient = new QueryClient({
      defaultOptions: {
        mutations: { retry: false },
        queries: { retry: false },
      },
    });

    vi.spyOn(queryClient, "invalidateQueries").mockImplementation(
      () =>
        new Promise(() => {
          return undefined;
        }),
    );
    vi.spyOn(queryClient, "refetchQueries").mockImplementation(
      () =>
        new Promise(() => {
          return undefined;
        }),
    );

    render(
      <MemoryRouter>
        <QueryClientProvider client={queryClient}>
          <DashboardPage viewMode="all" />
        </QueryClientProvider>
      </MemoryRouter>,
    );

    const duplicateButton = await screen.findByRole("button", { name: "Дублировать" });
    await userEvent.click(duplicateButton);

    await waitFor(() => {
      expect(cloneForm).toHaveBeenCalledWith(
        expect.objectContaining({ id: "form-1" }),
        "user-1",
      );
    });

    await waitFor(() => {
      expect(duplicateButton).not.toBeDisabled();
    });
  });

  it("hides author column for my forms and shows only the template badge in status", async () => {
    getForms.mockResolvedValue([
      {
        id: "template-1",
        title: "Шаблон анкеты",
        created_at: "2026-04-08T10:00:00.000Z",
        is_public: false,
        author_id: "user-1",
        author_name: "Иван Петров",
        author_email: "ivan@example.com",
        form_type: "template",
        form_reason: "plan",
        deadline_at: null,
        responses_count: 0,
        schema: { pages: [] },
      },
    ]);
    cloneForm.mockResolvedValue({ id: "template-2" });

    const queryClient = new QueryClient({
      defaultOptions: {
        mutations: { retry: false },
        queries: { retry: false },
      },
    });

    render(
      <MemoryRouter>
        <QueryClientProvider client={queryClient}>
          <DashboardPage viewMode="mine" />
        </QueryClientProvider>
      </MemoryRouter>,
    );

    expect(await screen.findByText("Шаблон анкеты")).toBeInTheDocument();
    const columnHeaders = screen.getAllByRole("columnheader");
    expect(columnHeaders.map((header) => header.textContent?.trim() ?? "")).toEqual(["Статус", "Название", "Дата", "Ответы", ""]);
    expect(screen.queryByText("Иван Петров")).not.toBeInTheDocument();
    expect(screen.getByText("Шаблон")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Закрыта" })).not.toBeInTheDocument();
    expect(screen.queryByTitle("Закрыта")).not.toBeInTheDocument();
  });

  it("opens the actions menu upward when there is not enough space below", async () => {
    getForms.mockResolvedValue([
      {
        id: "form-1",
        title: "Форма у нижнего края",
        created_at: "2026-04-08T10:00:00.000Z",
        is_public: true,
        author_id: "user-1",
        author_name: "Иван Петров",
        author_email: "ivan@example.com",
        form_type: "anketa",
        form_reason: "plan",
        deadline_at: null,
        responses_count: 3,
        schema: { pages: [] },
      },
    ]);

    const queryClient = new QueryClient({
      defaultOptions: {
        mutations: { retry: false },
        queries: { retry: false },
      },
    });

    render(
      <MemoryRouter>
        <QueryClientProvider client={queryClient}>
          <DashboardPage viewMode="all" />
        </QueryClientProvider>
      </MemoryRouter>,
    );

    const menuTrigger = await screen.findByRole("button", { name: "Действия с формой" });

    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: 620,
    });

    vi.spyOn(menuTrigger, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 590,
      width: 40,
      height: 40,
      top: 590,
      right: 40,
      bottom: 630,
      left: 0,
      toJSON: () => ({}),
    });

    await userEvent.click(menuTrigger);

    expect(screen.getByRole("menu")).toHaveClass("form-menu-dropdown-up");
  });
});
