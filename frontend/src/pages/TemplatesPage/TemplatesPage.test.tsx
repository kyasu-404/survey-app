import { readFileSync } from "node:fs";
import { join } from "node:path";
import { focusManager, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, type MemoryRouterProps } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { routes } from "../../app/routes";
import { getTemplateFormsQueryKey } from "../../entities/survey/model/queryKeys";
import type { SurveyForm } from "../../entities/survey/types";
import { getSurveyBuilderDraftStorageKey } from "../../widgets/SurveyBuilder/builderDraft";
import TemplatesPage from "./TemplatesPage";

const {
  authState,
  changeFormStatus,
  createFormFromTemplate,
  getFormById,
  getTemplateFormsPage,
  navigate,
  removeForm,
  renameForm,
  showToast,
} = vi.hoisted(() => ({
  authState: {
    loading: false,
    user: { id: "user-1" },
  },
  changeFormStatus: vi.fn(),
  createFormFromTemplate: vi.fn(),
  getFormById: vi.fn(),
  getTemplateFormsPage: vi.fn(),
  navigate: vi.fn(),
  removeForm: vi.fn(),
  renameForm: vi.fn(),
  showToast: vi.fn(),
}));

vi.mock("../../app/providers/AuthProvider", () => ({
  useAuth: () => authState,
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
  changeFormStatus,
  createFormFromTemplate,
  getFormById,
  getTemplateFormsPage,
  removeForm,
  renameForm,
}));

vi.mock("../../widgets/SurveyRenderer/SurveyRenderer", () => ({
  SurveyRenderer: ({
    schema,
    formId,
    isPreview,
    renderMode,
  }: {
    schema: { title?: string };
    formId: string;
    isPreview?: boolean;
    renderMode?: string;
  }) => (
    <div
      data-testid="template-preview-renderer"
      data-form-id={formId}
      data-preview={String(Boolean(isPreview))}
      data-render-mode={renderMode ?? ""}
    >
      {schema.title}
    </div>
  ),
}));

function createTemplate(index: number, overrides: Partial<SurveyForm> = {}): SurveyForm {
  return {
    id: `template-${index}`,
    title: `Шаблон ${index}`,
    created_at: `2026-04-${String(index).padStart(2, "0")}T10:00:00.000Z`,
    is_public: false,
    author_id: "user-1",
    author_name: "Автор шаблона",
    author_email: "author@example.com",
    form_type: "template",
    form_reason: "plan",
    deadline_at: null,
    responses_count: 0,
    schema: {
      title: `Шаблон ${index}`,
      pages: [{ name: "page1", elements: [{ type: "text", name: "q1", title: "Вопрос" }] }],
    },
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

function createTemplatesPage(items: SurveyForm[], totalCount = items.length) {
  return {
    items,
    totalCount,
  };
}

function createInfiniteTemplatesData(...pages: Array<ReturnType<typeof createTemplatesPage>>) {
  return {
    pages,
    pageParams: pages.map((_, index) => index),
  };
}

function renderPage(
  queryClient = createQueryClient(),
  initialEntries: MemoryRouterProps["initialEntries"] = ["/"],
) {
  const renderResult = render(
    <MemoryRouter initialEntries={initialEntries}>
      <QueryClientProvider client={queryClient}>
        <TemplatesPage />
      </QueryClientProvider>
    </MemoryRouter>,
  );

  return { queryClient, ...renderResult };
}

function readAppCss() {
  return readFileSync(join(process.cwd(), "src/app.css"), "utf8");
}

describe("TemplatesPage", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    authState.loading = false;
    authState.user = { id: "user-1" };
    changeFormStatus.mockResolvedValue(undefined);
    createFormFromTemplate.mockResolvedValue({ id: "created-from-template" });
    getFormById.mockResolvedValue(createTemplate(1));
    removeForm.mockResolvedValue(undefined);
    renameForm.mockResolvedValue(undefined);
  });

  it("renders template card creation time without seconds", async () => {
    getTemplateFormsPage.mockResolvedValue(
      createTemplatesPage([
        createTemplate(1, {
          title: "Шаблон без секунд",
          created_at: "2026-04-19T21:51:46",
        }),
      ]),
    );

    renderPage();

    expect(await screen.findByText("Шаблон без секунд")).toBeInTheDocument();
    expect(screen.getByText("Создан 19.04.2026, 21:51")).toBeInTheDocument();
    expect(screen.queryByText("Создан 19.04.2026, 21:51:46")).not.toBeInTheDocument();
  });

  it("renders my templates as a two-column gallery and opens a preview drawer from a card", async () => {
    const templates = [
      createTemplate(1, { title: "Заявка на конкурс" }),
      createTemplate(2, { title: "Анкета участника" }),
      createTemplate(3, { title: "Обычная форма", form_type: "anketa" }),
    ];
    getTemplateFormsPage.mockResolvedValue(createTemplatesPage(templates));

    const { container } = renderPage();

    expect(await screen.findByText("Заявка на конкурс")).toBeInTheDocument();
    expect(screen.getByText("Анкета участника")).toBeInTheDocument();
    expect(screen.queryByText("Обычная форма")).not.toBeInTheDocument();
    expect(container.querySelector(".templates-gallery-grid")).toBeInTheDocument();
    expect(container.querySelector(".templates-gallery-grid")).toHaveClass("templates-gallery-grid-two-columns");
    expect(getTemplateFormsPage).toHaveBeenCalledWith(
      expect.objectContaining({
        page: 0,
        pageSize: 20,
      }),
    );

    await userEvent.click(screen.getByRole("button", { name: "Открыть превью шаблона Заявка на конкурс" }));

    const dialog = await screen.findByRole("dialog", { name: "Превью шаблона Заявка на конкурс" });
    expect(dialog).toBeInTheDocument();
    expect(dialog.querySelector(".template-preview-title")).not.toBeInTheDocument();
    expect(getFormById).toHaveBeenCalledWith("template-1", expect.objectContaining({ signal: expect.any(Object) }));
    expect(container.querySelector(".template-preview-body")).toHaveClass("survey-page-card");
    expect(screen.getByTestId("template-preview-renderer")).toHaveAttribute(
      "data-render-mode",
      "readonly-navigable",
    );
  });

  it("uses a selected template as a new builder draft without creating a form", async () => {
    getTemplateFormsPage.mockResolvedValue(createTemplatesPage([createTemplate(1, { title: "Шаблон заявки" })]));
    getFormById.mockResolvedValue(createTemplate(1, { title: "Шаблон заявки" }));

    renderPage();

    const useTemplateButton = await screen.findByRole("button", { name: "Использовать шаблон Шаблон заявки" });
    expect(useTemplateButton.querySelector(".templates-action-icon")).toHaveAttribute("src", expect.stringContaining("use.svg"));

    await userEvent.click(useTemplateButton);

    await waitFor(() => {
      expect(navigate).toHaveBeenCalledWith(routes.builder);
    });

    expect(getFormById).toHaveBeenCalledWith("template-1", expect.objectContaining({ signal: expect.any(Object) }));
    expect(createFormFromTemplate).not.toHaveBeenCalled();
    expect(JSON.parse(localStorage.getItem(getSurveyBuilderDraftStorageKey()) ?? "{}")).toMatchObject({
      schema: expect.objectContaining({
        title: "Шаблон заявки",
        pages: [{ name: "page1", elements: [{ type: "text", name: "q1", title: "Вопрос" }] }],
      }),
    });
    expect(showToast).toHaveBeenCalledWith("Шаблон загружен в конструктор", "success");
  });

  it("offers template actions without creating a new form when editing", async () => {
    getTemplateFormsPage.mockResolvedValue(createTemplatesPage([createTemplate(1, { title: "Мой шаблон" })]));

    const { container } = renderPage();

    await userEvent.click(await screen.findByRole("button", { name: "Действия шаблона Мой шаблон" }));

    expect(container.querySelector(".templates-gallery-grid")).toHaveClass("templates-gallery-grid-menu-open");

    const menu = await screen.findByRole("menu", { name: "Меню действий шаблона Мой шаблон" });
    expect(menu).toHaveClass("templates-menu-dropdown");
    expect(menu.closest(".templates-card-actions")).toBeInTheDocument();
    expect(within(menu).getByRole("menuitem", { name: "Переименовать" })).toBeInTheDocument();
    expect(within(menu).getByRole("menuitem", { name: "Редактировать" })).toBeInTheDocument();
    expect(within(menu).getByRole("menuitem", { name: "Удалить" })).toBeInTheDocument();

    await userEvent.click(within(menu).getByRole("menuitem", { name: "Редактировать" }));

    expect(navigate).toHaveBeenCalledWith(routes.builderEdit("template-1"));
    expect(createFormFromTemplate).not.toHaveBeenCalled();
  });

  it("toggles publishing for my templates and shows author metadata for public templates", async () => {
    getTemplateFormsPage.mockImplementation((options: { filters?: { authorId?: string } } | undefined) =>
      Promise.resolve(
        createTemplatesPage(
          options?.filters?.authorId
            ? [
              createTemplate(1, {
                title: "Закрытый шаблон",
                is_public: false,
              }),
            ]
            : [
              createTemplate(2, {
                title: "Публичный шаблон",
                is_public: true,
                author_id: "user-2",
                author_name: "Мария Иванова",
              }),
            ],
        ),
      ),
    );

    const { container } = renderPage();

    const shareTemplateButton = await screen.findByRole("button", { name: "Поделиться шаблоном Закрытый шаблон" });
    expect(shareTemplateButton.querySelector(".templates-action-icon")).toHaveAttribute("src", expect.stringContaining("share.svg"));

    await userEvent.click(shareTemplateButton);

    expect(screen.getByRole("button", { name: "Поделиться шаблоном Закрытый шаблон" })).not.toHaveClass(
      "templates-share-button-muted",
    );

    await waitFor(() => {
      expect(changeFormStatus).toHaveBeenCalledWith("template-1", true);
    });

    await userEvent.click(screen.getByRole("tab", { name: "Публичные" }));

    expect(await screen.findByText("Публичный шаблон")).toBeInTheDocument();
    expect(screen.getByText("Мария Иванова")).toHaveClass("templates-card-author");
    expect(container.querySelector(".templates-card-meta-line")?.textContent).toContain("Создан");
  });

  it("uses a muted share button style when hiding an already public own template", async () => {
    getTemplateFormsPage.mockResolvedValue(
      createTemplatesPage([
        createTemplate(1, {
          title: "Опубликованный шаблон",
          is_public: true,
        }),
      ]),
    );

    renderPage();

    expect(await screen.findByRole("button", { name: "Не показывать другим шаблоном Опубликованный шаблон" })).toHaveClass(
      "templates-share-button-muted",
    );
  });

  it("pins templates locally, highlights the star, and keeps pinned templates first", async () => {
    getTemplateFormsPage.mockResolvedValue(
      createTemplatesPage([
        createTemplate(1, { title: "Первый шаблон" }),
        createTemplate(2, { title: "Важный шаблон" }),
        createTemplate(3, { title: "Третий шаблон" }),
      ]),
    );

    const { container } = renderPage();

    expect(await screen.findByText("Первый шаблон")).toBeInTheDocument();

    const getCardTitles = () =>
      Array.from(container.querySelectorAll(".templates-card-title")).map((title) => title.textContent);

    expect(getCardTitles()).toEqual(["Первый шаблон", "Важный шаблон", "Третий шаблон"]);

    const pinButton = screen.getByRole("button", { name: "Закрепить шаблон Важный шаблон" });
    await userEvent.click(pinButton);

    expect(screen.getByRole("button", { name: "Открепить шаблон Важный шаблон" })).toHaveClass(
      "templates-pin-button-active",
    );
    expect(getCardTitles()).toEqual(["Важный шаблон", "Первый шаблон", "Третий шаблон"]);
    expect(localStorage.getItem("survey-app:pinned-template-ids:user-1:mine")).toContain("template-2");
  });

  it("keeps pins in my templates separate from public templates", async () => {
    getTemplateFormsPage.mockImplementation((options: { filters?: { authorId?: string } } | undefined) =>
      Promise.resolve(
        createTemplatesPage(
          options?.filters?.authorId
            ? [
                createTemplate(1, { title: "Общий мой шаблон", is_public: true }),
                createTemplate(2, { title: "Мой второй шаблон" }),
              ]
            : [
                createTemplate(3, {
                  title: "Публичный первый шаблон",
                  is_public: true,
                  author_id: "user-2",
                }),
                createTemplate(1, { title: "Общий мой шаблон", is_public: true }),
              ],
        ),
      ),
    );

    const { container } = renderPage();
    const getCardTitles = () =>
      Array.from(container.querySelectorAll(".templates-card-title")).map((title) => title.textContent);

    expect(await screen.findByText("Общий мой шаблон")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Закрепить шаблон Общий мой шаблон" }));

    await userEvent.click(screen.getByRole("tab", { name: "Публичные" }));

    expect(await screen.findByText("Публичный первый шаблон")).toBeInTheDocument();
    expect(getCardTitles()).toEqual(["Публичный первый шаблон", "Общий мой шаблон"]);
    expect(screen.getByRole("button", { name: "Закрепить шаблон Общий мой шаблон" })).toBeInTheDocument();
  });

  it("does not show another user's pins to the current user", async () => {
    getTemplateFormsPage.mockResolvedValue(
      createTemplatesPage([
        createTemplate(1, { title: "Первый шаблон" }),
        createTemplate(2, { title: "Второй шаблон" }),
      ]),
    );

    authState.user = { id: "user-2" };
    const firstUserView = renderPage();

    expect(await screen.findByText("Первый шаблон")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Закрепить шаблон Второй шаблон" }));
    firstUserView.unmount();

    authState.user = { id: "user-1" };
    const { container } = renderPage();

    expect(await screen.findByText("Первый шаблон")).toBeInTheDocument();
    expect(Array.from(container.querySelectorAll(".templates-card-title")).map((title) => title.textContent)).toEqual([
      "Первый шаблон",
      "Второй шаблон",
    ]);
    expect(screen.getByRole("button", { name: "Закрепить шаблон Второй шаблон" })).toBeInTheDocument();
  });

  it("keeps template cards visible during a background refresh", async () => {
    let resolveRefresh!: (value: ReturnType<typeof createTemplatesPage>) => void;
    const refreshPromise = new Promise<ReturnType<typeof createTemplatesPage>>((resolve) => {
      resolveRefresh = resolve;
    });

    getTemplateFormsPage
      .mockResolvedValueOnce(createTemplatesPage([createTemplate(1, { title: "Тяжёлый шаблон" })]))
      .mockImplementationOnce(() => refreshPromise);

    const { container } = renderPage();

    expect(await screen.findByText("Тяжёлый шаблон")).toBeInTheDocument();
    expect(screen.getByText(/Обновлено \d{2}:\d{2}:\d{2}/)).toBeInTheDocument();

    const refreshButton = screen.getByRole("button", { name: "Обновить" });
    expect(refreshButton.querySelector("img.toolbar-icon")).toBeInTheDocument();
    expect(refreshButton.querySelector(".inline-spinner")).not.toBeInTheDocument();

    await userEvent.click(refreshButton);

    const refreshingButton = screen.getByRole("button", { name: "Обновляется..." });
    expect(refreshingButton.querySelector(".inline-spinner")).toBeInTheDocument();
    expect(refreshingButton.querySelector("img.toolbar-icon")).not.toBeInTheDocument();
    expect(container.querySelector(".dashboard-forms-grid-refreshing")).not.toBeInTheDocument();
    expect(screen.getByText("Тяжёлый шаблон")).toBeInTheDocument();

    resolveRefresh(createTemplatesPage([createTemplate(1, { title: "Тяжёлый шаблон" })]));
  });

  it("loads the next 20 templates when clicking the show more button", async () => {
    const templates = Array.from({ length: 25 }, (_, index) => createTemplate(index + 1, { title: `Шаблон ${index + 1}` }));

    getTemplateFormsPage.mockImplementation(({ page, pageSize }: { page: number; pageSize: number }) =>
      Promise.resolve(createTemplatesPage(templates.slice(page * pageSize, (page + 1) * pageSize), templates.length)),
    );

    renderPage();

    expect(await screen.findByText("Шаблон 20")).toBeInTheDocument();
    expect(screen.queryByText("Шаблон 21")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Показать ещё" }));

    await waitFor(() => {
      expect(getTemplateFormsPage).toHaveBeenLastCalledWith(
        expect.objectContaining({
          page: 1,
          pageSize: 20,
        }),
      );
    });

    expect(await screen.findByText("Шаблон 25")).toBeInTheDocument();
  });

  it("keeps pagination available when planned count underestimates a full templates page", async () => {
    const templates = Array.from({ length: 21 }, (_, index) =>
      createTemplate(index + 1, { title: `Шаблон ${index + 1}` }),
    );

    getTemplateFormsPage.mockImplementation(({ page, pageSize }: { page: number; pageSize: number }) =>
      Promise.resolve(
        createTemplatesPage(
          templates.slice(page * pageSize, (page + 1) * pageSize),
          page === 0 ? 19 : templates.length,
        ),
      ),
    );

    renderPage();

    expect(await screen.findByText("Шаблон 20")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Показать ещё" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Показать ещё" }));

    await waitFor(() => {
      expect(getTemplateFormsPage).toHaveBeenLastCalledWith(
        expect.objectContaining({
          page: 1,
          pageSize: 20,
        }),
      );
    });

    expect(await screen.findByText("Шаблон 21")).toBeInTheDocument();
  });

  it("triggers a background refresh when returning to templates with a refresh state", async () => {
    const queryClient = createQueryClient();
    const templatesQueryKey = getTemplateFormsQueryKey({
      section: "mine",
      pageSize: 20,
      userId: "user-1",
    });

    queryClient.setQueryData(
      templatesQueryKey,
      createInfiniteTemplatesData(createTemplatesPage([createTemplate(1, { title: "Кэшированный шаблон" })])),
    );

    getTemplateFormsPage.mockResolvedValueOnce(
      createTemplatesPage([
        createTemplate(1, { title: "Кэшированный шаблон" }),
        createTemplate(2, { title: "Новый шаблон" }),
      ]),
    );

    renderPage(queryClient, [{ pathname: routes.templates, state: { refreshList: true } }]);

    expect(screen.getByText("Кэшированный шаблон")).toBeInTheDocument();

    await waitFor(() => {
      expect(getTemplateFormsPage).toHaveBeenCalledTimes(1);
    });

    expect(await screen.findByText("Новый шаблон")).toBeInTheDocument();
    expect(navigate).toHaveBeenCalledWith(routes.templates, { replace: true, state: null });
  });

  it("forces a background refresh when opening templates with fresh cached data", async () => {
    const queryClient = createQueryClient();
    const templatesQueryKey = getTemplateFormsQueryKey({
      section: "mine",
      pageSize: 20,
      userId: "user-1",
    });

    queryClient.setQueryData(
      templatesQueryKey,
      createInfiniteTemplatesData(createTemplatesPage([createTemplate(1, { title: "Кэшированный шаблон" })])),
    );

    getTemplateFormsPage.mockResolvedValueOnce(
      createTemplatesPage([
        createTemplate(1, { title: "Кэшированный шаблон" }),
        createTemplate(2, { title: "Новый шаблон после открытия" }),
      ]),
    );

    renderPage(queryClient);

    expect(screen.getByText("Кэшированный шаблон")).toBeInTheDocument();

    await waitFor(() => {
      expect(getTemplateFormsPage).toHaveBeenCalledTimes(1);
    });

    expect(await screen.findByText("Новый шаблон после открытия")).toBeInTheDocument();
  });

  it("does not refresh templates when the browser tab becomes focused again", async () => {
    getTemplateFormsPage.mockResolvedValueOnce(createTemplatesPage([createTemplate(1, { title: "Шаблон до фокуса" })]));

    renderPage();

    expect(await screen.findByText("Шаблон до фокуса")).toBeInTheDocument();

    await waitFor(() => {
      expect(getTemplateFormsPage).toHaveBeenCalledTimes(1);
    });

    await act(async () => {
      focusManager.setFocused(false);
      focusManager.setFocused(true);
    });

    await waitFor(() => {
      expect(getTemplateFormsPage).toHaveBeenCalledTimes(1);
    }, { timeout: 100 });
  });

  it("keeps the template preview drawer wide enough for the survey page layout", () => {
    const css = readAppCss();

    expect(css).toMatch(/\.template-preview-drawer\s*\{[^}]*width:\s*min\(820px,\s*calc\(100vw - 32px\)\);/);
    expect(css).toMatch(/\.template-preview-drawer\s*\{[^}]*overflow-y:\s*auto;[^}]*overflow-x:\s*clip;/);
    expect(css).toMatch(/\.template-preview-body\.survey-page-card\s*\{[^}]*width:\s*100%;[^}]*max-width:\s*100%;[^}]*min-width:\s*0;[^}]*overflow:\s*visible;/);
  });

  it("keeps template preview controls, descriptions, and pinning affordance on the requested styling", () => {
    const css = readAppCss();

    expect(css).toMatch(/\.template-preview-close\s*\{[^}]*border:\s*0;[^}]*background:\s*#111111;[^}]*color:\s*#ffffff;/);
    expect(css).toMatch(/\.templates-use-button,\s*\.templates-share-button\s*\{[^}]*padding:\s*7px 10px;/);
    expect(css).toMatch(/\.templates-use-button\s*\{[^}]*background:\s*hsl\(0 0% 0% \/ 0\.8\);[^}]*border-color:\s*hsl\(0 0% 0% \/ 0\.8\);[^}]*box-shadow:\s*none;/);
    expect(css).toMatch(
      /\.templates-use-button:hover,\s*\.templates-use-button:focus-visible\s*\{[^}]*background:\s*hsl\(0 0% 0% \/ 0\.5\);[^}]*border-color:\s*hsl\(0 0% 0% \/ 0\.5\);[^}]*box-shadow:\s*0 16px 30px rgba\(20,\s*20,\s*20,\s*0\.12\),\s*var\(--surface-inset\);[^}]*transform:\s*translateY\(-2px\);/,
    );
    expect(css).toMatch(
      /\.templates-share-button:hover,\s*\.templates-share-button:focus-visible\s*\{[^}]*background:\s*rgba\(167,\s*139,\s*250,\s*0\.28\);[^}]*border-color:\s*rgba\(167,\s*139,\s*250,\s*0\.48\);[^}]*box-shadow:\s*0 16px 30px rgba\(109,\s*40,\s*217,\s*0\.18\),\s*var\(--surface-inset\);[^}]*transform:\s*translateY\(-2px\);/,
    );
    expect(css).toMatch(
      /\.templates-share-button\.templates-share-button-muted:hover,\s*\.templates-share-button\.templates-share-button-muted:focus-visible\s*\{[^}]*background:\s*rgba\(20,\s*20,\s*20,\s*0\.18\);[^}]*border-color:\s*rgba\(20,\s*20,\s*20,\s*0\.3\);[^}]*box-shadow:\s*0 16px 30px rgba\(20,\s*20,\s*20,\s*0\.16\),\s*var\(--surface-inset\);[^}]*transform:\s*translateY\(-2px\);/,
    );
    expect(css).toMatch(
      /\.template-preview-body\.survey-page-card \.sd-question \.sd-description,\s*\.template-preview-body\.survey-page-card \.sd-question__description\s*\{[^}]*background:\s*rgba\(219,\s*234,\s*254,\s*0\.88\)\s*!important;/,
    );
    expect(css).toMatch(/\.templates-pin-button\s*\{[^}]*font-size:\s*2\.1rem;/);
  });

  it("uses a gray border and rounded shape for template action menu trigger buttons", () => {
    const css = readAppCss();

    expect(css).toContain(".form-menu-trigger {");
    expect(css).toContain("border: 2px solid rgba(100, 116, 139, 0.52);");
    expect(css).toContain("border-color: rgba(100, 116, 139, 0.72);");
    expect(css).not.toContain("border: 2px solid rgba(20, 20, 20, 0.72);");
    expect(css).toMatch(
      /\.dashboard-actions-menu-shell\s+\.form-menu-trigger,\s*\.templates-actions-menu-shell\s+\.form-menu-trigger\s*\{[^}]*width:\s*54px;[^}]*min-width:\s*54px;[^}]*border-radius:\s*14px;/s,
    );
  });

  it("matches template card border thickness with dashboard form cards", () => {
    const css = readAppCss();

    expect(css).toMatch(/\.dashboard-forms-grid > \.dashboard-form-card\s*\{[^}]*border:\s*2px solid rgba\(20,\s*20,\s*20,\s*0\.14\);/);
    expect(css).toMatch(/\.templates-gallery-grid > \.templates-card\s*\{[^}]*border:\s*2px solid rgba\(20,\s*20,\s*20,\s*0\.14\);/);
  });

  it("aligns the template section tabs with the refresh button row", () => {
    const css = readAppCss();

    expect(css).toMatch(/\.templates-page-actions\s*\{[^}]*align-items:\s*flex-end;/);
  });

  it("renders template pin stars without a framed button background", () => {
    const css = readAppCss();

    expect(css).toMatch(/\.templates-pin-button\s*\{[^}]*border:\s*none;[^}]*background:\s*transparent;[^}]*font-size:\s*2\.1rem;/);
    expect(css).toMatch(/\.templates-pin-button:hover,\s*\.templates-pin-button:focus-visible\s*\{[^}]*background:\s*transparent;/);
    expect(css).toMatch(/\.templates-pin-button-active,[^{]*\{[^}]*background:\s*transparent;/);
  });
});
