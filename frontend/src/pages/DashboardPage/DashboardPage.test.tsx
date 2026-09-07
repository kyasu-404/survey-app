import { readFileSync } from "node:fs";
import { join } from "node:path";
import { focusManager, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, type MemoryRouterProps } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { routes } from "../../app/routes";
import { getDashboardFormStatsQueryKey, getDashboardFormsQueryKey } from "../../entities/survey/model/queryKeys";
import type { SurveyForm } from "../../entities/survey/types";
import DashboardPage from "./DashboardPage";

const {
  showToast,
  navigate,
  getDashboardFormsPage,
  getDashboardFormsStats,
  getFormById,
  cloneForm,
  changeFormStatus,
  setFormDeadline,
  setFormResponseLimit,
  qrToDataURL,
  qrToString,
  createRealtimeChannel,
  removeRealtimeChannel,
  emitRealtimeChange,
  emitRealtimeStatus,
  resetRealtimeChannel,
} = vi.hoisted(() => {
  type RealtimePayload = {
    eventType?: string;
    new?: Record<string, unknown> | null;
    old?: Record<string, unknown> | null;
  };
  type RealtimeChannel = {
    handlers: Array<(payload: RealtimePayload) => void>;
    statusHandler?: (status: string) => void;
    on: ReturnType<typeof vi.fn>;
    subscribe: ReturnType<typeof vi.fn>;
  };
  const activeChannels: RealtimeChannel[] = [];
  const createRealtimeChannel = vi.fn(() => {
    const channel: RealtimeChannel = {
      handlers: [],
      on: vi.fn((_event: string, _config: unknown, callback: (payload: RealtimePayload) => void) => {
        channel.handlers.push(callback);
        return channel;
      }),
      subscribe: vi.fn((callback?: (status: string) => void) => { channel.statusHandler = callback; return channel; }),
    };
    activeChannels.push(channel);
    return channel;
  });
  const removeRealtimeChannel = vi.fn((channel: RealtimeChannel) => {
    const channelIndex = activeChannels.indexOf(channel);
    if (channelIndex !== -1) {
      activeChannels.splice(channelIndex, 1);
    }
    return Promise.resolve("ok");
  });

  return {
    showToast: vi.fn(),
    navigate: vi.fn(),
    getDashboardFormsPage: vi.fn(),
    getDashboardFormsStats: vi.fn(),
    getFormById: vi.fn(),
    cloneForm: vi.fn(),
    changeFormStatus: vi.fn(),
    setFormDeadline: vi.fn(),
    setFormResponseLimit: vi.fn(),
    qrToDataURL: vi.fn(),
    qrToString: vi.fn(),
    createRealtimeChannel,
    removeRealtimeChannel,
    emitRealtimeChange: (payload: RealtimePayload = { eventType: "UPDATE", new: {}, old: {} }) => {
      for (const channel of activeChannels) {
        for (const handler of channel.handlers) {
          handler(payload);
        }
      }
    },
    emitRealtimeStatus: (status: string) => activeChannels.forEach((channel) => channel.statusHandler?.(status)),
    resetRealtimeChannel: () => {
      activeChannels.length = 0;
      createRealtimeChannel.mockClear();
      removeRealtimeChannel.mockClear();
    },
  };
});

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
  getDashboardFormsPage,
  getDashboardFormsStats,
  getFormById,
  cloneForm,
  renameForm: vi.fn(),
  removeForm: vi.fn(),
  changeFormStatus,
  setFormDeadline,
  setFormResponseLimit,
}));

vi.mock("../../entities/response/api", () => ({
  getResponsesByForm: vi.fn(),
}));

vi.mock("../../shared/api", () => ({
  supabaseClient: {
    channel: createRealtimeChannel,
    removeChannel: removeRealtimeChannel,
  },
}));

vi.mock("../../shared/lib/browser", () => ({
  copyTextToClipboard: vi.fn(),
}));

vi.mock("../../shared/lib/export", () => ({
  exportToExcel: vi.fn(),
}));

vi.mock("qrcode", () => ({
  default: {
    toDataURL: qrToDataURL,
    toString: qrToString,
  },
  toDataURL: qrToDataURL,
  toString: qrToString,
}));

function createForm(index: number, overrides: Partial<SurveyForm> = {}): SurveyForm {
  return {
    id: `form-${index}`,
    title: `Форма ${index}`,
    created_at: `2026-04-${String((index % 28) + 1).padStart(2, "0")}T10:00:00.000Z`,
    is_public: true,
    author_id: "user-2",
    author_name: `Автор ${index}`,
    author_email: `author${index}@example.com`,
    form_type: "anketa",
    form_reason: "plan",
    deadline_at: index % 2 === 0 ? `2099-05-${String((index % 28) + 1).padStart(2, "0")}T12:00:00.000Z` : null,
    max_responses: null,
    responses_count: index,
    schema: { pages: [] },
    theme: {},
    ...overrides,
  };
}

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: { retry: false },
    },
  });
}

function createDashboardPage(items: SurveyForm[], totalCount = items.length) {
  return {
    hasMore: items.length === 20,
    items,
    totalCount,
  };
}

function createDashboardStats(items: SurveyForm[], totalCount = items.length) {
  return {
    totalCount,
    activeCount: items.filter((form) => form.is_public && form.form_type !== "template").length,
    formsWithDeadlineCount: items.filter((form) => form.form_type !== "template" && Boolean(form.deadline_at)).length,
  };
}

function createInfiniteDashboardData(...pages: Array<ReturnType<typeof createDashboardPage>>) {
  return {
    pages,
    pageParams: pages.map((_, index) => index),
  };
}

function renderPage(
  viewMode: "mine" | "all" = "all",
  queryClient = createQueryClient(),
  initialEntries: MemoryRouterProps["initialEntries"] = ["/"],
) {
  const renderResult = render(
    <MemoryRouter initialEntries={initialEntries}>
      <QueryClientProvider client={queryClient}>
        <DashboardPage viewMode={viewMode} />
      </QueryClientProvider>
    </MemoryRouter>,
  );

  return { queryClient, ...renderResult };
}

function readAppCss() {
  return readFileSync(join(process.cwd(), "src/app.css"), "utf8");
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });

  return { promise, resolve };
}

describe("DashboardPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetRealtimeChannel();
    vi.spyOn(window, "confirm").mockImplementation(() => true);
    vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
    getDashboardFormsStats.mockResolvedValue({
      totalCount: 0,
      activeCount: 0,
      formsWithDeadlineCount: 0,
    });
    getFormById.mockResolvedValue(createForm(1));
    cloneForm.mockResolvedValue({ id: "form-copy" });
    changeFormStatus.mockResolvedValue(undefined);
    setFormDeadline.mockResolvedValue(undefined);
    setFormResponseLimit.mockResolvedValue(undefined);
    qrToString.mockResolvedValue('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"></svg>');
    qrToDataURL.mockResolvedValue("data:image/png;base64,transparent-qr");
  });


  it("refreshes both statistics and cards on manual refresh", async () => {
    getDashboardFormsPage.mockResolvedValue(createDashboardPage([createForm(1)]));
    renderPage();
    await screen.findByRole("button", { name: "Обновить" });
    await userEvent.click(screen.getByRole("button", { name: "Обновить" }));
    await waitFor(() => {
      expect(getDashboardFormsPage).toHaveBeenCalledTimes(2);
      expect(getDashboardFormsStats).toHaveBeenCalledTimes(2);
    });
  });

  it("reconciles cards and statistics after a websocket reconnect without a database event", async () => {
    getDashboardFormsPage.mockResolvedValue(createDashboardPage([createForm(1, { title: "До обрыва" })]));
    renderPage();
    expect(await screen.findByText("До обрыва")).toBeInTheDocument();
    getDashboardFormsPage.mockResolvedValue(createDashboardPage([createForm(1, { title: "После обрыва" })]));
    emitRealtimeStatus("CHANNEL_ERROR");
    emitRealtimeStatus("SUBSCRIBED");
    expect(await screen.findByText("После обрыва")).toBeInTheDocument();
    expect(getDashboardFormsStats).toHaveBeenCalledTimes(2);
  });

  it("renders form card creation time without seconds", async () => {
    getDashboardFormsPage.mockResolvedValue(
      createDashboardPage([
        createForm(1, {
          title: "Форма без секунд",
          created_at: "2026-04-19T21:51:46",
        }),
      ]),
    );

    renderPage();

    expect(await screen.findByText("Форма без секунд")).toBeInTheDocument();
    expect(screen.getByText("19.04.2026, 21:51")).toBeInTheDocument();
    expect(screen.queryByText("19.04.2026, 21:51:46")).not.toBeInTheDocument();
  });

  it("refreshes forms after a realtime database change", async () => {
    getDashboardFormsPage
      .mockResolvedValueOnce(createDashboardPage([createForm(1, { responses_count: 1 })]))
      .mockResolvedValueOnce(createDashboardPage([createForm(1, { responses_count: 2 })]));

    renderPage();

    expect(await screen.findByRole("button", { name: "1 ответ" })).toBeInTheDocument();

    emitRealtimeChange();

    await waitFor(() => {
      expect(getDashboardFormsPage).toHaveBeenCalledTimes(2);
    });

    expect(await screen.findByRole("button", { name: "2 ответа" })).toBeInTheDocument();
  });

  it("refreshes only the forms list for response count-only realtime updates", async () => {
    getDashboardFormsPage
      .mockResolvedValueOnce(createDashboardPage([createForm(1, { responses_count: 1 })]))
      .mockResolvedValueOnce(createDashboardPage([createForm(1, { responses_count: 2 })]));
    getDashboardFormsStats.mockResolvedValue(createDashboardStats([createForm(1, { responses_count: 1 })]));

    renderPage();

    expect(await screen.findByRole("button", { name: "1 ответ" })).toBeInTheDocument();

    await waitFor(() => {
      expect(getDashboardFormsStats).toHaveBeenCalledTimes(1);
    });

    emitRealtimeChange({
      eventType: "UPDATE",
      old: createForm(1, { responses_count: 1 }),
      new: createForm(1, { responses_count: 2 }),
    });

    await waitFor(() => {
      expect(getDashboardFormsPage).toHaveBeenCalledTimes(2);
    });

    expect(await screen.findByRole("button", { name: "2 ответа" })).toBeInTheDocument();
    expect(getDashboardFormsStats).toHaveBeenCalledTimes(1);
  });

  it("keeps the refresh button idle during a realtime background refresh", async () => {
    const deferred = createDeferred<ReturnType<typeof createDashboardPage>>();

    getDashboardFormsPage
      .mockResolvedValueOnce(createDashboardPage([createForm(1, { title: "Форма до realtime", responses_count: 1 })]))
      .mockImplementationOnce(() => deferred.promise);

    renderPage();

    expect(await screen.findByText("Форма до realtime")).toBeInTheDocument();

    emitRealtimeChange({
      eventType: "UPDATE",
      old: createForm(1, { title: "Форма до realtime", responses_count: 1 }),
      new: createForm(1, { title: "Форма до realtime", responses_count: 2 }),
    });

    await waitFor(() => {
      expect(getDashboardFormsPage).toHaveBeenCalledTimes(2);
    });

    const refreshButton = screen.getByRole("button", { name: "Обновить" });
    expect(screen.getByText(/синхронизация/i)).toBeInTheDocument();
    expect(refreshButton.querySelector("img.toolbar-icon")).toBeInTheDocument();
    expect(refreshButton.querySelector(".inline-spinner")).not.toBeInTheDocument();

    deferred.resolve(createDashboardPage([createForm(1, { title: "Форма до realtime", responses_count: 2 })]));
  });

  it("triggers a background refresh when returning to my forms with a refresh state", async () => {
    const queryClient = createQueryClient();
    const formsQueryKey = getDashboardFormsQueryKey({
      dateFrom: "",
      dateTo: "",
      formReason: "",
      formType: "",
      search: "",
      pageSize: 20,
      viewMode: "mine",
      userId: "user-1",
    });
    const statsQueryKey = getDashboardFormStatsQueryKey({
      dateFrom: "",
      dateTo: "",
      formReason: "",
      formType: "",
      search: "",
      viewMode: "mine",
      userId: "user-1",
    });

    queryClient.setQueryData(
      formsQueryKey,
      createInfiniteDashboardData(createDashboardPage([createForm(1, { title: "Кэшированная форма", author_id: "user-1" })])),
    );
    queryClient.setQueryData(
      statsQueryKey,
      createDashboardStats([createForm(1, { title: "Кэшированная форма", author_id: "user-1" })]),
    );

    getDashboardFormsPage.mockResolvedValueOnce(
      createDashboardPage([
        createForm(1, { title: "Кэшированная форма", author_id: "user-1" }),
        createForm(2, { title: "Новая форма", author_id: "user-1" }),
      ]),
    );
    getDashboardFormsStats.mockResolvedValueOnce(
      createDashboardStats([
        createForm(1, { title: "Кэшированная форма", author_id: "user-1" }),
        createForm(2, { title: "Новая форма", author_id: "user-1" }),
      ]),
    );

    renderPage("mine", queryClient, [{ pathname: routes.dashboardMy, state: { refreshList: true } }]);

    expect(screen.getByText("Кэшированная форма")).toBeInTheDocument();

    await waitFor(() => {
      expect(getDashboardFormsPage).toHaveBeenCalledTimes(1);
    });

    expect(await screen.findByText("Новая форма")).toBeInTheDocument();
    expect(navigate).toHaveBeenCalledWith(routes.dashboardMy, { replace: true, state: null });
  });

  it("forces a background refresh when opening my forms with fresh cached data", async () => {
    const queryClient = createQueryClient();
    const formsQueryKey = getDashboardFormsQueryKey({
      dateFrom: "",
      dateTo: "",
      formReason: "",
      formType: "",
      search: "",
      pageSize: 20,
      viewMode: "mine",
      userId: "user-1",
    });
    const statsQueryKey = getDashboardFormStatsQueryKey({
      dateFrom: "",
      dateTo: "",
      formReason: "",
      formType: "",
      search: "",
      viewMode: "mine",
      userId: "user-1",
    });

    queryClient.setQueryData(
      formsQueryKey,
      createInfiniteDashboardData(createDashboardPage([createForm(1, { title: "Кэшированная форма", author_id: "user-1" })])),
    );
    queryClient.setQueryData(
      statsQueryKey,
      createDashboardStats([createForm(1, { title: "Кэшированная форма", author_id: "user-1" })]),
    );

    getDashboardFormsPage.mockResolvedValueOnce(
      createDashboardPage([
        createForm(1, { title: "Кэшированная форма", author_id: "user-1" }),
        createForm(2, { title: "Новая форма после открытия", author_id: "user-1" }),
      ]),
    );
    getDashboardFormsStats.mockResolvedValueOnce(
      createDashboardStats([
        createForm(1, { title: "Кэшированная форма", author_id: "user-1" }),
        createForm(2, { title: "Новая форма после открытия", author_id: "user-1" }),
      ]),
    );

    renderPage("mine", queryClient, [routes.dashboardMy]);

    expect(screen.getByText("Кэшированная форма")).toBeInTheDocument();

    await waitFor(() => {
      expect(getDashboardFormsPage).toHaveBeenCalledTimes(1);
    });

    expect(await screen.findByText("Новая форма после открытия")).toBeInTheDocument();
  });

  it("does not refresh forms when the browser tab becomes focused again", async () => {
    getDashboardFormsPage.mockResolvedValueOnce(createDashboardPage([createForm(1, { title: "Форма до фокуса" })]));

    renderPage();

    expect(await screen.findByText("Форма до фокуса")).toBeInTheDocument();

    await waitFor(() => {
      expect(getDashboardFormsPage).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(getDashboardFormsStats).toHaveBeenCalledTimes(1);
    });

    await act(async () => {
      focusManager.setFocused(false);
      focusManager.setFocused(true);
    });

    await waitFor(() => {
      expect(getDashboardFormsPage).toHaveBeenCalledTimes(1);
      expect(getDashboardFormsStats).toHaveBeenCalledTimes(1);
    }, { timeout: 100 });
  });

  it("shows form stats inside the info popover and paginates the list", async () => {
    const forms = Array.from({ length: 25 }, (_, index) => createForm(index + 1));
    const queryClient = createQueryClient();

    queryClient.setQueryData(
      getDashboardFormStatsQueryKey({
        dateFrom: "",
        dateTo: "",
        formReason: "",
        formType: "",
        search: "",
        viewMode: "all",
        userId: "user-1",
      }),
      createDashboardStats(forms, forms.length),
    );

    getDashboardFormsPage.mockImplementation(({ page, pageSize }: { page: number; pageSize: number }) =>
      Promise.resolve(createDashboardPage(forms.slice(page * pageSize, (page + 1) * pageSize), forms.length)),
    );
    getDashboardFormsStats.mockResolvedValue(createDashboardStats(forms, forms.length));

    renderPage("all", queryClient);

    await waitFor(() => {
      expect(getDashboardFormsPage).toHaveBeenCalledWith(
        expect.objectContaining({
          page: 0,
          pageSize: 20,
        }),
      );
    });

    expect(await screen.findByText("Форма 20")).toBeInTheDocument();
    expect(screen.queryByText("Форма 21")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Показать ещё" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Статистика форм" }));

    const statsPopover = await screen.findByRole("dialog", { name: "Сводка по формам" });
    expect(within(statsPopover).getByText("Всего форм")).toBeInTheDocument();
    expect(within(statsPopover).getByText("Активных")).toBeInTheDocument();
    expect(within(statsPopover).getByText("С дедлайном")).toBeInTheDocument();
    expect(within(statsPopover).getAllByText("25")).toHaveLength(2);
    expect(within(statsPopover).getByText("12")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Показать ещё" }));
    await waitFor(() => {
      expect(getDashboardFormsPage).toHaveBeenLastCalledWith(
        expect.objectContaining({
          page: 1,
          pageSize: 20,
        }),
      );
    });
    expect(await screen.findByText("Форма 25")).toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Количество форм" })).not.toBeInTheDocument();
  });

  it("does not offer another page when the lookahead confirms exactly 20 forms", async () => {
    const forms = Array.from({ length: 20 }, (_, index) => createForm(index + 1));

    getDashboardFormsPage.mockResolvedValue({
      ...createDashboardPage(forms, forms.length),
      hasMore: false,
    });
    getDashboardFormsStats.mockResolvedValue(createDashboardStats(forms, forms.length));

    renderPage();

    expect(await screen.findByText("Форма 20")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Показать ещё" })).not.toBeInTheDocument();
  });

  it("keeps pagination available when planned count underestimates a full dashboard page", async () => {
    const forms = Array.from({ length: 21 }, (_, index) => createForm(index + 1));

    getDashboardFormsPage.mockImplementation(({ page, pageSize }: { page: number; pageSize: number }) =>
      Promise.resolve(
        createDashboardPage(
          forms.slice(page * pageSize, (page + 1) * pageSize),
          page === 0 ? 19 : forms.length,
        ),
      ),
    );
    getDashboardFormsStats.mockResolvedValue(createDashboardStats(forms, forms.length));

    renderPage();

    expect(await screen.findByText("Форма 20")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Показать ещё" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Показать ещё" }));

    await waitFor(() => {
      expect(getDashboardFormsPage).toHaveBeenLastCalledWith(
        expect.objectContaining({
          page: 1,
          pageSize: 20,
        }),
      );
    });
    expect(await screen.findByText("Форма 21")).toBeInTheDocument();
  });

  it("shows exact stats instead of an inflated planned list count", async () => {
    const forms = Array.from({ length: 4 }, (_, index) => createForm(index + 1, { deadline_at: null }));

    getDashboardFormsPage.mockResolvedValue(createDashboardPage(forms, 58));
    getDashboardFormsStats.mockResolvedValue(createDashboardStats(forms, forms.length));

    renderPage();

    expect(await screen.findByText("Форма 4")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Статистика форм" }));

    const statsPopover = await screen.findByRole("dialog", { name: "Сводка по формам" });
    expect(within(statsPopover).queryByText("58")).not.toBeInTheDocument();
    expect(within(statsPopover).getAllByText("4")).toHaveLength(2);
    expect(within(statsPopover).getByText("0")).toBeInTheDocument();
  });

  it("debounces dashboard search before requesting filtered forms and stats", async () => {
    getDashboardFormsPage.mockResolvedValue(createDashboardPage([]));
    getDashboardFormsStats.mockResolvedValue(createDashboardStats([], 0));

    renderPage();

    const searchInput = await screen.findByPlaceholderText("Поиск по названию и автору");

    await waitFor(() => {
      expect(getDashboardFormsPage).toHaveBeenCalledTimes(1);
      expect(getDashboardFormsStats).toHaveBeenCalledTimes(1);
    });

    await userEvent.type(searchInput, "план");

    expect(searchInput).toHaveValue("план");

    await new Promise((resolve) => window.setTimeout(resolve, 100));

    expect(getDashboardFormsPage).toHaveBeenCalledTimes(1);
    expect(getDashboardFormsStats).toHaveBeenCalledTimes(1);

    await waitFor(
      () => {
        expect(getDashboardFormsPage).toHaveBeenCalledTimes(2);
        expect(getDashboardFormsStats).toHaveBeenCalledTimes(2);
      },
      { timeout: 800 },
    );

    expect(getDashboardFormsPage).toHaveBeenLastCalledWith(
      expect.objectContaining({
        filters: expect.objectContaining({
          search: "план",
        }),
      }),
    );
    expect(getDashboardFormsStats).toHaveBeenLastCalledWith(
      expect.objectContaining({
        search: "план",
      }),
      expect.objectContaining({ signal: expect.any(Object) }),
    );
  });

  it("renders a loading label with a spinner while the forms list is loading", async () => {
    const deferred = createDeferred<ReturnType<typeof createDashboardPage>>();

    getDashboardFormsPage.mockImplementation(() => deferred.promise);

    const { container } = renderPage();

    expect(await screen.findByText("Загрузка форм")).toBeInTheDocument();
    expect(container.querySelector(".dashboard-forms-loading .inline-spinner")).toBeInTheDocument();
    expect(container.querySelector(".dashboard-form-skeleton")).not.toBeInTheDocument();

    deferred.resolve(createDashboardPage([]));

    expect(await screen.findByText("Форм пока нет")).toBeInTheDocument();
  });

  it("keeps the forms list interactive during a background refresh", async () => {
    const deferred = createDeferred<ReturnType<typeof createDashboardPage>>();
    getDashboardFormsPage
      .mockResolvedValueOnce(createDashboardPage([createForm(1, { title: "Обновляемая форма" })]))
      .mockImplementationOnce(() => deferred.promise);

    const { container } = renderPage();

    expect(await screen.findByText("Обновляемая форма")).toBeInTheDocument();
    expect(screen.getByText(/Обновлено \d{2}:\d{2}:\d{2}/)).toBeInTheDocument();

    const refreshButton = screen.getByRole("button", { name: "Обновить" });
    expect(refreshButton.querySelector("img.toolbar-icon")).toBeInTheDocument();
    expect(refreshButton.querySelector(".inline-spinner")).not.toBeInTheDocument();

    await userEvent.click(refreshButton);

    const refreshingButton = screen.getByRole("button", { name: "Обновляется..." });
    expect(refreshingButton.querySelector(".inline-spinner")).toBeInTheDocument();
    expect(refreshingButton.querySelector("img.toolbar-icon")).not.toBeInTheDocument();
    expect(screen.queryByText("Загрузка форм")).not.toBeInTheDocument();
    expect(container.querySelector(".dashboard-form-skeleton")).not.toBeInTheDocument();
    expect(container.querySelector(".dashboard-forms-grid-refreshing")).not.toBeInTheDocument();
    expect(screen.getByText("Обновляемая форма")).toBeInTheDocument();

    await act(async () => {
      deferred.resolve(createDashboardPage([createForm(1, { title: "Обновляемая форма" })]));
    });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Обновить|Обновлено/ })).not.toBeDisabled();
    });
  });

  it("shows type and reason on form cards and filters the list by both fields", async () => {
    const forms = [
      createForm(1, {
        title: "Мониторинг по приказу",
        author_id: "user-1",
        author_name: "admin",
        form_type: "monitoring",
        form_reason: "order",
      }),
      createForm(2, {
        title: "Опрос по запросу",
        author_id: "user-2",
        author_name: "operator",
        form_type: "survey",
        form_reason: "request",
      }),
    ];

    getDashboardFormsPage.mockImplementation(({ filters }: { filters?: { formType?: string; formReason?: string } }) => {
      const filteredItems = forms.filter((form) => {
        if (filters?.formType && form.form_type !== filters.formType) {
          return false;
        }

        if (filters?.formReason && form.form_reason !== filters.formReason) {
          return false;
        }

        return true;
      });

      return Promise.resolve(createDashboardPage(filteredItems, filteredItems.length));
    });
    getDashboardFormsStats.mockImplementation((filters?: { formType?: string; formReason?: string }) => {
      const filteredItems = forms.filter((form) => {
        if (filters?.formType && form.form_type !== filters.formType) {
          return false;
        }

        if (filters?.formReason && form.form_reason !== filters.formReason) {
          return false;
        }

        return true;
      });

      return Promise.resolve(createDashboardStats(filteredItems, filteredItems.length));
    });

    renderPage("all");

    expect(await screen.findByText("Мониторинг по приказу")).toBeInTheDocument();
    expect(
      screen.getByText((_, element) => {
        if (!element?.classList.contains("dashboard-form-classification")) {
          return false;
        }

        return element.textContent?.replace(/\s+/g, "").trim() === "Мониторинг•Приказ";
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("admin")).toBeInTheDocument();

    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Тип формы" }), "survey");
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Основание формы" }), "request");

    await waitFor(() => {
      expect(getDashboardFormsPage).toHaveBeenLastCalledWith(
        expect.objectContaining({
          filters: expect.objectContaining({
            formType: "survey",
            formReason: "request",
          }),
        }),
      );
    });

    expect(await screen.findByText("Опрос по запросу")).toBeInTheDocument();
    expect(screen.queryByText("Мониторинг по приказу")).not.toBeInTheDocument();
  });

  it("does not refresh filtered all-forms dashboard for irrelevant realtime form changes", async () => {
    const forms = [
      createForm(1, {
        title: "Мониторинг по приказу",
        author_id: "user-1",
        author_name: "admin",
        form_type: "monitoring",
        form_reason: "order",
      }),
      createForm(2, {
        title: "Опрос по запросу",
        author_id: "user-2",
        author_name: "operator",
        form_type: "survey",
        form_reason: "request",
      }),
    ];

    getDashboardFormsPage.mockImplementation(({ filters }: { filters?: { formType?: string; formReason?: string } }) => {
      const filteredItems = forms.filter((form) => {
        if (filters?.formType && form.form_type !== filters.formType) {
          return false;
        }

        if (filters?.formReason && form.form_reason !== filters.formReason) {
          return false;
        }

        return true;
      });

      return Promise.resolve(createDashboardPage(filteredItems, filteredItems.length));
    });
    getDashboardFormsStats.mockImplementation((filters?: { formType?: string; formReason?: string }) => {
      const filteredItems = forms.filter((form) => {
        if (filters?.formType && form.form_type !== filters.formType) {
          return false;
        }

        if (filters?.formReason && form.form_reason !== filters.formReason) {
          return false;
        }

        return true;
      });

      return Promise.resolve(createDashboardStats(filteredItems, filteredItems.length));
    });

    renderPage("all");

    expect(await screen.findByText("Мониторинг по приказу")).toBeInTheDocument();

    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Тип формы" }), "survey");
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Основание формы" }), "request");

    await waitFor(() => {
      expect(getDashboardFormsPage).toHaveBeenLastCalledWith(
        expect.objectContaining({
          filters: expect.objectContaining({
            formType: "survey",
            formReason: "request",
          }),
        }),
      );
    });
    expect(await screen.findByText("Опрос по запросу")).toBeInTheDocument();

    const callsAfterFiltering = getDashboardFormsPage.mock.calls.length;
    emitRealtimeChange({
      eventType: "UPDATE",
      new: createForm(3, {
        title: "Чужой мониторинг",
        form_type: "monitoring",
        form_reason: "order",
      }),
      old: createForm(3, {
        title: "Чужой мониторинг",
        form_type: "monitoring",
        form_reason: "order",
      }),
    });

    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 850));
    });

    expect(getDashboardFormsPage).toHaveBeenCalledTimes(callsAfterFiltering);
  });

  it("refreshes filtered all-forms dashboard for relevant realtime form changes", async () => {
    const forms = [
      createForm(1, {
        title: "Опрос по запросу",
        author_id: "user-2",
        author_name: "operator",
        form_type: "survey",
        form_reason: "request",
      }),
    ];

    getDashboardFormsPage.mockImplementation(({ filters }: { filters?: { formType?: string; formReason?: string } }) => {
      const filteredItems = forms.filter((form) => {
        if (filters?.formType && form.form_type !== filters.formType) {
          return false;
        }

        if (filters?.formReason && form.form_reason !== filters.formReason) {
          return false;
        }

        return true;
      });

      return Promise.resolve(createDashboardPage(filteredItems, filteredItems.length));
    });
    getDashboardFormsStats.mockImplementation((filters?: { formType?: string; formReason?: string }) => {
      const filteredItems = forms.filter((form) => {
        if (filters?.formType && form.form_type !== filters.formType) {
          return false;
        }

        if (filters?.formReason && form.form_reason !== filters.formReason) {
          return false;
        }

        return true;
      });

      return Promise.resolve(createDashboardStats(filteredItems, filteredItems.length));
    });

    renderPage("all");

    expect(await screen.findByText("Опрос по запросу")).toBeInTheDocument();

    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Тип формы" }), "survey");
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Основание формы" }), "request");

    await waitFor(() => {
      expect(getDashboardFormsPage).toHaveBeenLastCalledWith(
        expect.objectContaining({
          filters: expect.objectContaining({
            formType: "survey",
            formReason: "request",
          }),
        }),
      );
    });

    const callsAfterFiltering = getDashboardFormsPage.mock.calls.length;
    emitRealtimeChange({
      eventType: "UPDATE",
      new: createForm(1, {
        title: "Опрос по запросу",
        form_type: "survey",
        form_reason: "request",
        deadline_at: "2099-05-10T12:00:00.000Z",
      }),
      old: createForm(1, {
        title: "Опрос по запросу",
        form_type: "survey",
        form_reason: "request",
        deadline_at: null,
      }),
    });

    await waitFor(() => {
      expect(getDashboardFormsPage).toHaveBeenCalledTimes(callsAfterFiltering + 1);
    });
  });

  it("keeps the current scroll position when showing more forms", async () => {
    const forms = Array.from({ length: 25 }, (_, index) => createForm(index + 1));
    getDashboardFormsPage.mockImplementation(({ page, pageSize }: { page: number; pageSize: number }) =>
      Promise.resolve(createDashboardPage(forms.slice(page * pageSize, (page + 1) * pageSize), forms.length)),
    );
    Object.defineProperty(window, "scrollX", { configurable: true, value: 12 });
    Object.defineProperty(window, "scrollY", { configurable: true, value: 360 });
    const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);

    renderPage();

    expect(await screen.findByText("Форма 20")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Показать ещё" }));

    expect(await screen.findByText("Форма 25")).toBeInTheDocument();
    await waitFor(() => {
      expect(scrollTo).toHaveBeenCalledWith({ left: 12, top: 360, behavior: "auto" });
    });
  });

  it("opens preview from the card and responses from the counter button", async () => {
    getDashboardFormsPage.mockResolvedValue(
      createDashboardPage([
        createForm(1, {
          title: "Тестовая форма",
          responses_count: 3,
        }),
      ]),
    );

    renderPage();

    const previewCard = await screen.findByRole("button", {
      name: "Открыть превью формы Тестовая форма",
    });
    const responsesButton = screen.getByRole("button", { name: "3 ответа" });

    await userEvent.click(responsesButton);
    expect(navigate).toHaveBeenCalledWith(routes.formResponses("form-1"));

    navigate.mockClear();

    await userEvent.click(previewCard);
    expect(navigate).toHaveBeenCalledWith(routes.survey("form-1"), {
      state: { renderMode: "preview-interactive" },
    });
  });

  it("shows owner-only actions in the menu and re-enables the trigger after duplication", async () => {
    getDashboardFormsPage.mockResolvedValue(
      createDashboardPage([
        createForm(1, {
          title: "Моя форма",
          author_id: "user-1",
          author_name: "Я",
        }),
      ]),
    );
    getFormById.mockResolvedValue(
      createForm(1, {
        title: "Моя форма",
        author_id: "user-1",
        author_name: "Я",
      }),
    );

    const queryClient = createQueryClient();
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

    renderPage("all", queryClient);

    const menuTrigger = await screen.findByRole("button", { name: "Действия формы Моя форма" });
    await userEvent.click(menuTrigger);

    const menu = await screen.findByRole("menu", { name: "Меню действий формы Моя форма" });
    expect(within(menu).getByRole("menuitem", { name: "Копировать ссылку" })).toBeInTheDocument();
    expect(within(menu).getByRole("menuitem", { name: "Переименовать" })).toBeInTheDocument();
    expect(within(menu).getByRole("menuitem", { name: "Редактировать" })).toBeInTheDocument();
    expect(within(menu).getByRole("menuitem", { name: "Дублировать" })).toBeInTheDocument();
    expect(within(menu).getByRole("menuitem", { name: "Удалить" })).toBeInTheDocument();

    await userEvent.click(within(menu).getByRole("menuitem", { name: "Дублировать" }));

    await waitFor(() => {
      expect(getFormById).toHaveBeenCalledWith("form-1", expect.objectContaining({ signal: expect.any(Object) }));
      expect(cloneForm).toHaveBeenCalledWith(
        expect.objectContaining({ id: "form-1" }),
        "user-1",
      );
    });

    await waitFor(() => {
      expect(menuTrigger).not.toBeDisabled();
    });
  });

  it("renders action icons in the dropdown menu and a deadline icon in form metadata", async () => {
    getDashboardFormsPage.mockResolvedValue(
      createDashboardPage([
        createForm(1, {
          title: "Моя форма",
          author_id: "user-1",
          deadline_at: "2099-05-10T12:00:00.000Z",
        }),
      ]),
    );

    const { container } = renderPage();

    const searchInput = await screen.findByPlaceholderText("Поиск по названию и автору");
    const searchGroup = searchInput.closest(".dashboard-search-group");
    expect(searchGroup).not.toBeNull();
    expect(searchGroup?.querySelector(".dashboard-search-icon")).toBeInTheDocument();

    await userEvent.click(await screen.findByRole("button", { name: "Действия формы Моя форма" }));

    const menu = await screen.findByRole("menu", { name: "Меню действий формы Моя форма" });
    const copyLinkButton = within(menu).getByRole("menuitem", { name: "Копировать ссылку" });
    const renameButton = within(menu).getByRole("menuitem", { name: "Переименовать" });
    const editButton = within(menu).getByRole("menuitem", { name: "Редактировать" });
    const duplicateButton = within(menu).getByRole("menuitem", { name: "Дублировать" });
    const deleteButton = within(menu).getByRole("menuitem", { name: "Удалить" });

    expect(copyLinkButton.querySelector(".form-menu-item-icon")).toBeInTheDocument();
    expect(copyLinkButton.querySelector(".form-menu-item-label")).toBeInTheDocument();
    expect(renameButton.querySelector(".form-menu-item-icon")).toBeInTheDocument();
    expect(renameButton.querySelector(".form-menu-item-label")).toBeInTheDocument();
    expect(editButton.querySelector(".form-menu-item-icon")).toBeInTheDocument();
    expect(editButton.querySelector(".form-menu-item-label")).toBeInTheDocument();
    expect(duplicateButton.querySelector(".form-menu-item-icon")).toBeInTheDocument();
    expect(duplicateButton.querySelector(".form-menu-item-label")).toBeInTheDocument();
    expect(deleteButton.querySelector(".form-menu-item-icon")).toBeInTheDocument();
    expect(deleteButton.querySelector(".form-menu-item-label")).toBeInTheDocument();

    expect(container.querySelector(".dashboard-meta-item-deadline .dashboard-meta-icon")).toBeInTheDocument();
    const deadlineText = container.querySelector(".dashboard-meta-item-deadline")?.textContent ?? "";
    expect(deadlineText).toMatch(/открыта до \d{2}\.\d{2}\.\d{4}, \d{2}:\d{2}$/);
    expect(deadlineText).not.toMatch(/\d{2}:\d{2}:\d{2}/);
  });

  it("opens a generated QR dialog and downloads the QR on request", async () => {
    getDashboardFormsPage.mockResolvedValue(
      createDashboardPage([
        createForm(1, {
          title: "QR форма",
          author_id: "user-1",
        }),
      ]),
    );
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);

    renderPage();

    await userEvent.click(await screen.findByRole("button", { name: "Действия формы QR форма" }));

    const menu = await screen.findByRole("menu", { name: "Меню действий формы QR форма" });
    const copyLinkButton = within(menu).getByRole("menuitem", { name: "Копировать ссылку" });
    const generateQrButton = within(menu).getByRole("menuitem", { name: "Генерировать QR" });

    expect(copyLinkButton.compareDocumentPosition(generateQrButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(qrToString).not.toHaveBeenCalled();

    await userEvent.click(generateQrButton);

    const formLink = `${window.location.origin}${routes.survey("form-1")}`;
    await waitFor(() => {
      expect(qrToString).toHaveBeenCalledWith(
        formLink,
        expect.objectContaining({
          color: expect.objectContaining({ light: "#00000000" }),
          type: "svg",
        }),
      );
    });

    const dialog = await screen.findByRole("dialog", { name: "QR-код формы QR форма" });
    expect(within(dialog).getByRole("button", { name: "Закрыть QR-код" })).toHaveClass("dashboard-qr-close-button");
    expect(within(dialog).getByRole("button", { name: "PNG" })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "SVG" })).toBeInTheDocument();
    expect(within(dialog).getByAltText("QR-код формы QR форма")).toHaveAttribute("src", expect.stringMatching(/^data:image\/svg\+xml/));
    expect(within(dialog).getByText(formLink)).toBeInTheDocument();

    await userEvent.click(within(dialog).getByRole("button", { name: "PNG" }));

    await waitFor(() => {
      expect(qrToDataURL).toHaveBeenCalledWith(
        formLink,
        expect.objectContaining({
          color: expect.objectContaining({ light: "#00000000" }),
          type: "image/png",
        }),
      );
    });
    expect(anchorClick).toHaveBeenCalledTimes(1);

    await userEvent.click(within(dialog).getByRole("button", { name: "SVG" }));

    await waitFor(() => {
      expect(qrToString).toHaveBeenCalledTimes(2);
    });
    expect(anchorClick).toHaveBeenCalledTimes(2);
  });

  it("shows the compact action set for non-owners and the status dropdown for owners", async () => {
    getDashboardFormsPage.mockResolvedValue(
      createDashboardPage([
        createForm(1, {
          title: "Чужая форма",
          author_id: "user-2",
        }),
        createForm(2, {
          title: "Закрытая форма",
          author_id: "user-1",
          is_public: false,
          deadline_at: null,
        }),
      ]),
    );

    renderPage();

    const guestMenuTrigger = await screen.findByRole("button", { name: "Действия формы Чужая форма" });
    await userEvent.click(guestMenuTrigger);

    const guestMenu = await screen.findByRole("menu", { name: "Меню действий формы Чужая форма" });
    expect(within(guestMenu).getByRole("menuitem", { name: "Копировать ссылку" })).toBeInTheDocument();
    expect(within(guestMenu).getByRole("menuitem", { name: "Дублировать" })).toBeInTheDocument();
    expect(within(guestMenu).queryByRole("menuitem", { name: "Переименовать" })).not.toBeInTheDocument();
    expect(within(guestMenu).queryByRole("menuitem", { name: "Удалить" })).not.toBeInTheDocument();

    navigate.mockClear();
    await userEvent.click(guestMenu);
    expect(navigate).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "Статус формы Закрытая форма: Закрыта" }));

    const statusMenu = await screen.findByRole("menu", { name: "Статус формы Закрытая форма" });
    expect(screen.getByRole("button", { name: "Статус формы Закрытая форма: Закрыта" })).toHaveClass("dashboard-status-trigger-glossy");
    expect(screen.getByRole("button", { name: "2 ответа" })).toHaveClass("dashboard-responses-link-hitbox");
    expect(statusMenu).toHaveClass("dashboard-status-dropdown");
    expect(statusMenu.closest(".dashboard-form-header")).toHaveClass("dashboard-form-header-status-menu-open");
    expect(within(statusMenu).getByRole("menuitem", { name: "Открыть" })).toHaveClass("dashboard-status-menu-item-open");
    expect(within(statusMenu).getByRole("menuitem", { name: "Установить дедлайн" })).toBeInTheDocument();

    navigate.mockClear();
    await userEvent.click(statusMenu);
    expect(navigate).not.toHaveBeenCalled();
  });

  it("keeps dashboard form cards subtly cool-gray highlighted and action triggers visibly outlined", () => {
    const css = readAppCss();

    expect(css).toContain(".dashboard-forms-grid > .dashboard-form-card {");
    expect(css).toContain("border: 2px solid rgba(20, 20, 20, 0.14);");
    expect(css).toContain(".dashboard-forms-grid > .dashboard-form-card-interactive:hover");
    expect(css).toContain("rgba(148, 163, 184, 0.12)");
    expect(css).toContain("rgba(248, 250, 252, 0.96)");
    expect(css).toContain("0 0 22px rgba(100, 116, 139, 0.1)");
    expect(css).not.toContain("0 0 34px rgba(37, 99, 235, 0.18)");
    expect(css).toContain("border: 2px solid rgba(100, 116, 139, 0.52);");
    expect(css).toContain("border-color: rgba(100, 116, 139, 0.72);");
    expect(css).not.toContain("border-width: 3px;");
    expect(css).toMatch(/:root\[data-theme="graphite"\] \.dashboard-forms-grid > \.dashboard-form-card-interactive:hover,[^{]+\{[^}]*transform:\s*translateY\(-4px\);[^}]*background:\s*var\(--theme-card-background\);[^}]*0 26px 54px var\(--theme-shadow-color\),[^}]*var\(--theme-accent-soft\)/s);
  });

  it("styles active and closed form status controls from the selected application theme", () => {
    const css = readAppCss();

    expect(css).toMatch(/\.dashboard-status-pill-active,\s*button\.dashboard-status-trigger-glossy\.dashboard-status-pill-active,[^{]+\{[^}]*color:\s*#ffffff;[^}]*border-color:\s*transparent;[^}]*background:\s*var\(--theme-accent-gradient\);/s);
    expect(css).toMatch(/\.dashboard-status-pill-closed,\s*button\.dashboard-status-trigger-glossy\.dashboard-status-pill-closed,[^{]+\{[^}]*color:\s*var\(--theme-text\);[^}]*border-color:\s*var\(--theme-border\);[^}]*background:\s*linear-gradient\(180deg,\s*var\(--theme-surface-light\),\s*var\(--theme-surface\)\);/s);
  });

  it("keeps the regular responses counter readable in every application theme", () => {
    const css = readAppCss();

    expect(css).toMatch(/\.dashboard-responses-link,\s*\.dashboard-responses-link:hover\s*\{[^}]*color:\s*var\(--theme-text\);/s);
    expect(css).toMatch(/\.dashboard-responses-link-limit-reached,[^{]+\{[^}]*color:\s*#b91c1c;/s);
  });

  it("uses requested colors for dashboard deadline, limit, and QR close actions", () => {
    const css = readAppCss();

    expect(css).toMatch(/\.deadline-action-cancel-button\s*\{[^}]*background:\s*linear-gradient\(180deg,\s*#27272a,\s*#111111\);[^}]*color:\s*#ffffff;/);
    expect(css).toMatch(/\.dashboard-settings-modal\s+\.deadline-action-clear-button\s*\{[^}]*background:\s*#fee2e2;[^}]*color:\s*#b91c1c;/);
    expect(css).toMatch(/\.dashboard-settings-modal\s+\.deadline-action-save-button\s*\{[^}]*background:\s*linear-gradient\(180deg,\s*#ffffff,\s*#f8fafc\);[^}]*color:\s*#141414;/);
    expect(css).toMatch(/\.dashboard-qr-close-button\s*\{[^}]*border-color:\s*transparent;[^}]*background:\s*transparent;[^}]*color:\s*#b91c1c;[^}]*font-size:\s*3\.2rem;[^}]*font-weight:\s*800;/);
  });

  it("centers dashboard delete modal headings", () => {
    const css = readAppCss();

    expect(css).toMatch(/\.dashboard-delete-modal-title,\s*\.users-modal-title\s*\{[^}]*text-align:\s*center;/);
  });

  it("opens form action menus to the left of the trigger instead of below the card", () => {
    const css = readAppCss();

    expect(css).toMatch(
      /\.dashboard-actions-menu-shell\s+\.form-menu-dropdown,\s*\.templates-actions-menu-shell\s+\.form-menu-dropdown\s*\{[^}]*top:\s*auto;[^}]*right:\s*calc\(100% \+ 12px\);[^}]*bottom:\s*0;[^}]*left:\s*auto;[^}]*transform-origin:\s*bottom right;/s,
    );
    expect(css).toMatch(
      /\.dashboard-actions-menu-shell-open-down\s+\.form-menu-dropdown\s*\{[^}]*top:\s*0;[^}]*bottom:\s*auto;[^}]*transform-origin:\s*top right;/s,
    );
  });

  it("keeps card action menus wide enough for single-line labels and rounds only their ellipsis triggers", () => {
    const css = readAppCss();

    expect(css).toMatch(
      /\.dashboard-actions-menu-shell\s+\.form-menu-trigger,\s*\.templates-actions-menu-shell\s+\.form-menu-trigger\s*\{[^}]*width:\s*54px;[^}]*min-width:\s*54px;[^}]*border-radius:\s*14px;/s,
    );
    expect(css).toMatch(
      /\.dashboard-actions-menu-shell\s+\.form-menu-dropdown,\s*\.templates-actions-menu-shell\s+\.form-menu-dropdown\s*\{[^}]*min-width:\s*236px;/s,
    );
    expect(css).toMatch(
      /\.dashboard-actions-menu-shell\s+\.form-menu-item-label,\s*\.templates-actions-menu-shell\s+\.form-menu-item-label\s*\{[^}]*white-space:\s*nowrap;/s,
    );
  });

  it("marks only the first visible form action menu to open downward", async () => {
    getDashboardFormsPage.mockResolvedValue(
      createDashboardPage([
        createForm(1, { title: "Верхняя форма", author_id: "user-1" }),
        createForm(2, { title: "Нижняя форма", author_id: "user-1" }),
      ]),
    );

    renderPage();

    const topMenuTrigger = await screen.findByRole("button", { name: "Действия формы Верхняя форма" });
    const lowerMenuTrigger = await screen.findByRole("button", { name: "Действия формы Нижняя форма" });

    expect(topMenuTrigger.closest(".dashboard-actions-menu-shell")).toHaveClass("dashboard-actions-menu-shell-open-down");
    expect(lowerMenuTrigger.closest(".dashboard-actions-menu-shell")).not.toHaveClass("dashboard-actions-menu-shell-open-down");
  });

  it("uses destructive and positive colors for status menu actions", async () => {
    getDashboardFormsPage.mockResolvedValue(
      createDashboardPage([
        createForm(1, {
          title: "Открытая форма",
          author_id: "user-1",
          is_public: true,
        }),
        createForm(2, {
          title: "Закрытая форма",
          author_id: "user-1",
          is_public: false,
          deadline_at: null,
        }),
      ]),
    );

    renderPage();

    await userEvent.click(await screen.findByRole("button", { name: "Статус формы Открытая форма: Активна" }));
    expect(within(await screen.findByRole("menu", { name: "Статус формы Открытая форма" })).getByRole("menuitem", { name: "Закрыть" })).toHaveClass(
      "form-menu-item-danger",
    );

    await userEvent.click(screen.getByRole("button", { name: "Статус формы Закрытая форма: Закрыта" }));
    expect(within(await screen.findByRole("menu", { name: "Статус формы Закрытая форма" })).getByRole("menuitem", { name: "Открыть" })).toHaveClass(
      "dashboard-status-menu-item-open",
    );
  });

  it("keeps templates out of the my forms dashboard", async () => {
    getDashboardFormsPage.mockResolvedValue(
      createDashboardPage([
        createForm(1, {
          title: "Обычная форма",
          author_id: "user-1",
          form_type: "anketa",
        }),
        createForm(2, {
          title: "Шаблон отчёта",
          author_id: "user-1",
          form_type: "template",
        }),
      ]),
    );

    renderPage("mine");

    expect(await screen.findByText("Обычная форма")).toBeInTheDocument();
    expect(screen.queryByText("Автор 1")).not.toBeInTheDocument();
    expect(screen.queryByText("Шаблон отчёта")).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText("Поиск по названию")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Тип формы" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Основание формы" })).toBeInTheDocument();
  });

  it("renders the current user's author name without special highlighting on the all forms dashboard", async () => {
    const css = readAppCss();

    expect(css).not.toContain(".dashboard-meta-item-author-own");

    getDashboardFormsPage.mockResolvedValue(
      createDashboardPage([
        createForm(1, {
          title: "Своя форма",
          author_id: "user-1",
          author_name: "Автор текущий",
        }),
        createForm(2, {
          title: "Чужая форма",
          author_id: "user-2",
          author_name: "Автор другой",
        }),
      ]),
    );

    renderPage("all");

    expect(await screen.findByText("Своя форма")).toBeInTheDocument();
    expect(screen.getByText("Автор текущий")).toHaveClass("dashboard-meta-item");
    expect(screen.getByText("Автор текущий")).not.toHaveClass("dashboard-meta-item-author-own");
    expect(screen.getByText("Автор другой")).not.toHaveClass("dashboard-meta-item-author-own");
  });

  it("renders the delete modal action wrapper for dashboard styling", async () => {
    getDashboardFormsPage.mockResolvedValue(
      createDashboardPage([
        createForm(1, {
          title: "Моя форма",
          author_id: "user-1",
        }),
      ]),
    );

    const { container } = renderPage("all");

    await userEvent.click(await screen.findByRole("button", { name: "Действия формы Моя форма" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Удалить" }));

    expect(screen.getByRole("heading", { name: "Удаление формы" })).toHaveClass("dashboard-delete-modal-title");
    expect(container.querySelector(".dashboard-delete-modal-actions")).toBeInTheDocument();
    expect(container.querySelector(".dashboard-delete-modal-actions .dashboard-danger-button")).toBeInTheDocument();
  });

  it("asks for confirmation and clears deadline before closing a public form with deadline", async () => {
    getDashboardFormsPage.mockResolvedValue(
      createDashboardPage([
        createForm(1, {
          title: "Публичная форма",
          author_id: "user-1",
          is_public: true,
          deadline_at: "2099-05-10T12:00:00.000Z",
        }),
      ]),
    );

    renderPage();

    await userEvent.click(await screen.findByRole("button", { name: "Статус формы Публичная форма: Активна" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Закрыть" }));

    expect(window.confirm).toHaveBeenCalledWith(
      "Закрытие публичной формы приведёт к удалению текущего дедлайна. Вы хотите продолжить?",
    );

    await waitFor(() => {
      expect(setFormDeadline).toHaveBeenCalledWith("form-1", null);
    });

    await waitFor(() => {
      expect(changeFormStatus).toHaveBeenCalledWith("form-1", false);
    });
  });

  it("does not close a public form with deadline when user rejects the warning", async () => {
    vi.mocked(window.confirm).mockReturnValue(false);

    getDashboardFormsPage.mockResolvedValue(
      createDashboardPage([
        createForm(1, {
          title: "Публичная форма",
          author_id: "user-1",
          is_public: true,
          deadline_at: "2099-05-10T12:00:00.000Z",
        }),
      ]),
    );

    renderPage();

    await userEvent.click(await screen.findByRole("button", { name: "Статус формы Публичная форма: Активна" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Закрыть" }));

    expect(changeFormStatus).not.toHaveBeenCalled();
    expect(setFormDeadline).not.toHaveBeenCalled();
  });

  it("shows an error toast instead of reopening a form whose response limit is reached", async () => {
    getDashboardFormsPage.mockResolvedValue(
      createDashboardPage([
        createForm(1, {
          title: "Заполненная закрытая форма",
          author_id: "user-1",
          is_public: false,
          deadline_at: null,
          responses_count: 5,
          max_responses: 5,
        }),
      ]),
    );

    renderPage();

    await userEvent.click(await screen.findByRole("button", { name: "Статус формы Заполненная закрытая форма: Закрыта" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Открыть" }));

    expect(showToast).toHaveBeenCalledWith("Сначала уберите или повысьте лимит ответов", "error");
    expect(changeFormStatus).not.toHaveBeenCalled();
  });

  it("disables deadline clearing when the form has no deadline", async () => {
    getDashboardFormsPage.mockResolvedValue(
      createDashboardPage([
        createForm(1, {
          title: "Форма без дедлайна",
          author_id: "user-1",
          deadline_at: null,
        }),
      ]),
    );

    renderPage();

    await userEvent.click(await screen.findByRole("button", { name: "Статус формы Форма без дедлайна: Активна" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Установить дедлайн" }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("heading", { name: "Дедлайн формы" })).toHaveClass("deadline-modal-title");
    expect(within(dialog).getByRole("button", { name: "Отмена" })).toHaveClass("deadline-action-cancel-button");
    expect(within(dialog).getByRole("button", { name: "Снять дедлайн" })).toHaveClass("deadline-action-clear-button");
    expect(within(dialog).getByRole("button", { name: "Сохранить" })).toHaveClass("deadline-action-save-button");
    expect(screen.getByRole("button", { name: "Снять дедлайн" })).toBeDisabled();
  });

  it("shows response limits in counters and lets owners edit or clear the limit from the status menu", async () => {
    getDashboardFormsPage.mockResolvedValue(
      createDashboardPage([
        createForm(1, {
          title: "Лимитируемая форма",
          author_id: "user-1",
          responses_count: 3,
          max_responses: 10,
        }),
        createForm(2, {
          title: "Заполненная форма",
          author_id: "user-1",
          responses_count: 5,
          max_responses: 5,
        }),
      ]),
    );

    renderPage();

    expect(await screen.findByRole("button", { name: "3/10 ответов" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "5 ответов" })).toHaveClass("dashboard-responses-link-limit-reached");

    await userEvent.click(screen.getByRole("button", { name: "Статус формы Лимитируемая форма: Активна" }));

    const statusMenu = await screen.findByRole("menu", { name: "Статус формы Лимитируемая форма" });
    expect(within(statusMenu).getByRole("menuitem", { name: "Ограничить ответы" })).toBeInTheDocument();

    await userEvent.click(within(statusMenu).getByRole("menuitem", { name: "Ограничить ответы" }));

    const limitDialog = await screen.findByRole("dialog", { name: "Ограничение ответов" });
    expect(within(limitDialog).getByRole("heading", { name: "Ограничение ответов" })).toHaveClass("deadline-modal-title");
    const limitInput = within(limitDialog).getByLabelText("Максимум ответов");
    const clearButton = within(limitDialog).getByRole("button", { name: "Снять ограничение" });

    expect(limitInput).toHaveValue(10);
    expect(clearButton).toBeEnabled();

    await userEvent.clear(limitInput);
    await userEvent.type(limitInput, "12");
    await userEvent.click(within(limitDialog).getByRole("button", { name: "Сохранить" }));

    await waitFor(() => {
      expect(setFormResponseLimit).toHaveBeenCalledWith("form-1", 12);
    });

    await userEvent.click(screen.getByRole("button", { name: "Статус формы Лимитируемая форма: Активна" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Ограничить ответы" }));
    await userEvent.click(within(await screen.findByRole("dialog", { name: "Ограничение ответов" })).getByRole("button", { name: "Снять ограничение" }));

    await waitFor(() => {
      expect(setFormResponseLimit).toHaveBeenCalledWith("form-1", null);
    });
  });

  it("does not save a response limit below the number of collected responses", async () => {
    getDashboardFormsPage.mockResolvedValue(
      createDashboardPage([
        createForm(1, {
          title: "Форма с ответами",
          author_id: "user-1",
          responses_count: 4,
          max_responses: null,
        }),
      ]),
    );

    renderPage();

    await userEvent.click(await screen.findByRole("button", { name: "Статус формы Форма с ответами: Активна" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Ограничить ответы" }));

    const limitDialog = await screen.findByRole("dialog", { name: "Ограничение ответов" });
    const limitInput = within(limitDialog).getByLabelText("Максимум ответов");

    await userEvent.clear(limitInput);
    await userEvent.type(limitInput, "3");
    await userEvent.click(within(limitDialog).getByRole("button", { name: "Сохранить" }));

    expect(showToast).toHaveBeenCalledWith(
      "Лимит ответов не может быть меньше количества уже полученных ответов",
      "error",
    );
    expect(setFormResponseLimit).not.toHaveBeenCalled();
  });

  it("keeps the response limit clear button visible but disabled when no limit is set", async () => {
    getDashboardFormsPage.mockResolvedValue(
      createDashboardPage([
        createForm(1, {
          title: "Форма без лимита",
          author_id: "user-1",
          responses_count: 2,
          max_responses: null,
        }),
      ]),
    );

    renderPage();

    await userEvent.click(await screen.findByRole("button", { name: "Статус формы Форма без лимита: Активна" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Ограничить ответы" }));

    expect((await screen.findByRole("dialog", { name: "Ограничение ответов" })).querySelector(".deadline-clear-button")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Снять ограничение" })).toBeDisabled();
  });
});
