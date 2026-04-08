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
} = vi.hoisted(() => ({
  showToast: vi.fn(),
  navigate: vi.fn(),
  getForms: vi.fn(),
  cloneForm: vi.fn(),
  changeFormStatus: vi.fn(),
  setFormDeadline: vi.fn(),
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
  changeFormStatus,
  setFormDeadline,
}));

vi.mock("../../entities/response/api", () => ({
  getResponsesByForm: vi.fn(),
}));

vi.mock("../../shared/lib/browser", () => ({
  copyTextToClipboard: vi.fn(),
}));

vi.mock("../../shared/lib/export", () => ({
  exportToExcel: vi.fn(),
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
  render(
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>
        <DashboardPage viewMode={viewMode} />
      </QueryClientProvider>
    </MemoryRouter>,
  );

  return { queryClient };
}

describe("DashboardPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cloneForm.mockResolvedValue({ id: "form-copy" });
    changeFormStatus.mockResolvedValue(undefined);
    setFormDeadline.mockResolvedValue(undefined);
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
    expect(navigate).toHaveBeenCalledWith(routes.survey("form-1"));
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

    await userEvent.click(screen.getByRole("button", { name: "Статус формы Закрытая форма: Закрыта" }));

    const statusMenu = await screen.findByRole("menu", { name: "Статус формы Закрытая форма" });
    expect(within(statusMenu).getByRole("menuitem", { name: "Открыть" })).toBeInTheDocument();
    expect(within(statusMenu).getByRole("menuitem", { name: "Установить дедлайн" })).toBeInTheDocument();
  });
});
