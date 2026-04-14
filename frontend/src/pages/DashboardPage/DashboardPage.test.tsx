import { readFileSync } from "node:fs";
import { join } from "node:path";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { routes } from "../../app/routes";
import type { SurveyForm } from "../../entities/survey/types";
import DashboardPage from "./DashboardPage";

const {
  showToast,
  navigate,
  getForms,
  cloneForm,
  changeFormStatus,
  setFormDeadline,
  setFormResponseLimit,
  qrToDataURL,
  qrToString,
  createRealtimeChannel,
  removeRealtimeChannel,
  emitRealtimeChange,
  resetRealtimeChannel,
} = vi.hoisted(() => {
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
    showToast: vi.fn(),
    navigate: vi.fn(),
    getForms: vi.fn(),
    cloneForm: vi.fn(),
    changeFormStatus: vi.fn(),
    setFormDeadline: vi.fn(),
    setFormResponseLimit: vi.fn(),
    qrToDataURL: vi.fn(),
    qrToString: vi.fn(),
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
    deadline_at: index % 2 === 0 ? `2026-05-${String((index % 28) + 1).padStart(2, "0")}T12:00:00.000Z` : null,
    max_responses: null,
    responses_count: index,
    schema: { pages: [] },
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

function renderPage(viewMode: "mine" | "all" = "all", queryClient = createQueryClient()) {
  const renderResult = render(
    <MemoryRouter>
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
    cloneForm.mockResolvedValue({ id: "form-copy" });
    changeFormStatus.mockResolvedValue(undefined);
    setFormDeadline.mockResolvedValue(undefined);
    setFormResponseLimit.mockResolvedValue(undefined);
    qrToString.mockResolvedValue('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"></svg>');
    qrToDataURL.mockResolvedValue("data:image/png;base64,transparent-qr");
  });

  it("refreshes forms after a realtime database change", async () => {
    getForms
      .mockResolvedValueOnce([createForm(1, { responses_count: 1 })])
      .mockResolvedValueOnce([createForm(1, { responses_count: 2 })]);

    renderPage();

    expect(await screen.findByRole("button", { name: "1 ответ" })).toBeInTheDocument();

    emitRealtimeChange();

    await waitFor(() => {
      expect(getForms).toHaveBeenCalledTimes(2);
    });

    expect(await screen.findByRole("button", { name: "2 ответа" })).toBeInTheDocument();
  });

  it("shows form stats inside the info popover and paginates the list", async () => {
    getForms.mockResolvedValue(Array.from({ length: 25 }, (_, index) => createForm(index + 1)));

    renderPage();

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
    expect(await screen.findByText("Форма 25")).toBeInTheDocument();

    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Количество форм" }), "50");
    expect(screen.getByText("Форма 21")).toBeInTheDocument();

    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Количество форм" }), "20");
    expect(screen.queryByText("Форма 21")).not.toBeInTheDocument();
  });

  it("renders a loading label with a spinner while the forms list is loading", async () => {
    const deferred = createDeferred<SurveyForm[]>();

    getForms.mockImplementation(() => deferred.promise);

    const { container } = renderPage();

    expect(await screen.findByText("Загрузка форм")).toBeInTheDocument();
    expect(container.querySelector(".dashboard-forms-loading .inline-spinner")).toBeInTheDocument();
    expect(container.querySelector(".dashboard-form-skeleton")).not.toBeInTheDocument();

    deferred.resolve([]);

    expect(await screen.findByText("Форм пока нет")).toBeInTheDocument();
  });

  it("keeps the forms list refresh state as a loading label without skeleton cards", async () => {
    const deferred = createDeferred<SurveyForm[]>();
    getForms
      .mockResolvedValueOnce([createForm(1, { title: "Обновляемая форма" })])
      .mockImplementationOnce(() => deferred.promise);

    const { container } = renderPage();

    expect(await screen.findByText("Обновляемая форма")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Обновить" }));

    expect(await screen.findByText("Загрузка форм")).toBeInTheDocument();
    expect(container.querySelector(".dashboard-forms-loading .inline-spinner")).toBeInTheDocument();
    expect(container.querySelector(".dashboard-refresh-overlay")).not.toBeInTheDocument();
    expect(container.querySelector(".dashboard-form-skeleton")).not.toBeInTheDocument();

    deferred.resolve([createForm(1, { title: "Обновляемая форма" })]);
  });

  it("keeps the current scroll position when showing more forms", async () => {
    getForms.mockResolvedValue(Array.from({ length: 25 }, (_, index) => createForm(index + 1)));
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
    getForms.mockResolvedValue([
      createForm(1, {
        title: "Тестовая форма",
        responses_count: 3,
      }),
    ]);

    renderPage();

    const previewCard = await screen.findByRole("button", {
      name: "Открыть превью формы Тестовая форма",
    });
    const responsesButton = screen.getByRole("button", { name: "3 ответа" });

    await userEvent.click(responsesButton);
    expect(navigate).toHaveBeenCalledWith(routes.formResponses("form-1"));

    navigate.mockClear();

    await userEvent.click(previewCard);
    expect(navigate).toHaveBeenCalledWith(routes.survey("form-1"), { state: { isPreview: true } });
  });

  it("shows owner-only actions in the menu and re-enables the trigger after duplication", async () => {
    getForms.mockResolvedValue([
      createForm(1, {
        title: "Моя форма",
        author_id: "user-1",
        author_name: "Я",
      }),
    ]);

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
    getForms.mockResolvedValue([
      createForm(1, {
        title: "Моя форма",
        author_id: "user-1",
        deadline_at: "2026-05-10T12:00:00.000Z",
      }),
    ]);

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
  });

  it("opens a generated QR dialog and downloads the QR on request", async () => {
    getForms.mockResolvedValue([
      createForm(1, {
        title: "QR форма",
        author_id: "user-1",
      }),
    ]);
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
    getForms.mockResolvedValue([
      createForm(1, {
        title: "Чужая форма",
        author_id: "user-2",
      }),
      createForm(2, {
        title: "Закрытая форма",
        author_id: "user-1",
        is_public: false,
      }),
    ]);

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

  it("marks only the first visible form action menu to open downward", async () => {
    getForms.mockResolvedValue([
      createForm(1, { title: "Верхняя форма", author_id: "user-1" }),
      createForm(2, { title: "Нижняя форма", author_id: "user-1" }),
    ]);

    renderPage();

    const topMenuTrigger = await screen.findByRole("button", { name: "Действия формы Верхняя форма" });
    const lowerMenuTrigger = await screen.findByRole("button", { name: "Действия формы Нижняя форма" });

    expect(topMenuTrigger.closest(".dashboard-actions-menu-shell")).toHaveClass("dashboard-actions-menu-shell-open-down");
    expect(lowerMenuTrigger.closest(".dashboard-actions-menu-shell")).not.toHaveClass("dashboard-actions-menu-shell-open-down");
  });

  it("uses destructive and positive colors for status menu actions", async () => {
    getForms.mockResolvedValue([
      createForm(1, {
        title: "Открытая форма",
        author_id: "user-1",
        is_public: true,
      }),
      createForm(2, {
        title: "Закрытая форма",
        author_id: "user-1",
        is_public: false,
      }),
    ]);

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
    getForms.mockResolvedValue([
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
    ]);

    renderPage("mine");

    expect(await screen.findByText("Обычная форма")).toBeInTheDocument();
    expect(screen.queryByText("Шаблон отчёта")).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Тип форм" })).not.toBeInTheDocument();
  });

  it("renders the delete modal action wrapper for dashboard styling", async () => {
    getForms.mockResolvedValue([
      createForm(1, {
        title: "Моя форма",
        author_id: "user-1",
      }),
    ]);

    const { container } = renderPage("all");

    await userEvent.click(await screen.findByRole("button", { name: "Действия формы Моя форма" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Удалить" }));

    expect(container.querySelector(".dashboard-delete-modal-actions")).toBeInTheDocument();
    expect(container.querySelector(".dashboard-delete-modal-actions .dashboard-danger-button")).toBeInTheDocument();
  });

  it("asks for confirmation and clears deadline before closing a public form with deadline", async () => {
    getForms.mockResolvedValue([
      createForm(1, {
        title: "Публичная форма",
        author_id: "user-1",
        is_public: true,
        deadline_at: "2026-05-10T12:00:00.000Z",
      }),
    ]);

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

    getForms.mockResolvedValue([
      createForm(1, {
        title: "Публичная форма",
        author_id: "user-1",
        is_public: true,
        deadline_at: "2026-05-10T12:00:00.000Z",
      }),
    ]);

    renderPage();

    await userEvent.click(await screen.findByRole("button", { name: "Статус формы Публичная форма: Активна" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Закрыть" }));

    expect(changeFormStatus).not.toHaveBeenCalled();
    expect(setFormDeadline).not.toHaveBeenCalled();
  });

  it("disables deadline clearing when the form has no deadline", async () => {
    getForms.mockResolvedValue([
      createForm(1, {
        title: "Форма без дедлайна",
        author_id: "user-1",
        deadline_at: null,
      }),
    ]);

    renderPage();

    await userEvent.click(await screen.findByRole("button", { name: "Статус формы Форма без дедлайна: Активна" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Установить дедлайн" }));

    expect(screen.getByRole("button", { name: "Снять дедлайн" })).toBeDisabled();
  });

  it("shows response limits in counters and lets owners edit or clear the limit from the status menu", async () => {
    getForms.mockResolvedValue([
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
    ]);

    renderPage();

    expect(await screen.findByRole("button", { name: "3/10 ответов" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "5 ответов" })).toHaveClass("dashboard-responses-link-limit-reached");

    await userEvent.click(screen.getByRole("button", { name: "Статус формы Лимитируемая форма: Активна" }));

    const statusMenu = await screen.findByRole("menu", { name: "Статус формы Лимитируемая форма" });
    expect(within(statusMenu).getByRole("menuitem", { name: "Ограничить ответы" })).toBeInTheDocument();

    await userEvent.click(within(statusMenu).getByRole("menuitem", { name: "Ограничить ответы" }));

    const limitDialog = await screen.findByRole("dialog", { name: "Ограничение ответов" });
    const limitInput = within(limitDialog).getByLabelText("Максимум ответов");

    expect(limitInput).toHaveValue(10);

    await userEvent.clear(limitInput);
    await userEvent.type(limitInput, "12");
    await userEvent.click(within(limitDialog).getByRole("button", { name: "Сохранить" }));

    await waitFor(() => {
      expect(setFormResponseLimit).toHaveBeenCalledWith("form-1", 12);
    });

    await userEvent.click(screen.getByRole("button", { name: "Статус формы Лимитируемая форма: Активна" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Ограничить ответы" }));
    await userEvent.click((await screen.findByRole("dialog", { name: "Ограничение ответов" })).querySelector(".deadline-clear-button")!);

    await waitFor(() => {
      expect(setFormResponseLimit).toHaveBeenCalledWith("form-1", null);
    });
  });
});
