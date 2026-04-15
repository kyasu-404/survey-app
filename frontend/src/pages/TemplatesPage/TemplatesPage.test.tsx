import { readFileSync } from "node:fs";
import { join } from "node:path";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, type MemoryRouterProps } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { routes } from "../../app/routes";
import { getTemplateFormsQueryKey } from "../../entities/survey/model/queryKeys";
import type { SurveyForm } from "../../entities/survey/types";
import { getSurveyBuilderDraftStorageKey } from "../../widgets/SurveyBuilder/builderDraft";
import TemplatesPage from "./TemplatesPage";

const {
  changeFormStatus,
  createFormFromTemplate,
  getFormById,
  getTemplateFormsPage,
  navigate,
  removeForm,
  renameForm,
  showToast,
} = vi.hoisted(() => ({
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
  changeFormStatus,
  createFormFromTemplate,
  getFormById,
  getTemplateFormsPage,
  removeForm,
  renameForm,
}));

vi.mock("../../widgets/SurveyRenderer/SurveyRenderer", () => ({
  SurveyRenderer: ({ schema, formId, isPreview }: { schema: { title?: string }; formId: string; isPreview?: boolean }) => (
    <div data-testid="template-preview-renderer" data-form-id={formId} data-preview={String(Boolean(isPreview))}>
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
    changeFormStatus.mockResolvedValue(undefined);
    createFormFromTemplate.mockResolvedValue({ id: "created-from-template" });
    getFormById.mockResolvedValue(createTemplate(1));
    removeForm.mockResolvedValue(undefined);
    renameForm.mockResolvedValue(undefined);
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
      }),
    );

    await userEvent.click(screen.getByRole("button", { name: "Открыть превью шаблона Заявка на конкурс" }));

    expect(await screen.findByRole("dialog", { name: "Превью шаблона Заявка на конкурс" })).toBeInTheDocument();
    expect(getFormById).toHaveBeenCalledWith("template-1");
    expect(container.querySelector(".template-preview-body")).toHaveClass("survey-page-card");
    expect(screen.getByTestId("template-preview-renderer")).toHaveAttribute("data-preview", "true");
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

    expect(getFormById).toHaveBeenCalledWith("template-1");
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

    await userEvent.click(screen.getByRole("button", { name: "Обновить" }));

    expect(container.querySelector(".dashboard-forms-grid-refreshing")).not.toBeInTheDocument();
    expect(screen.getByText("Тяжёлый шаблон")).toBeInTheDocument();

    resolveRefresh(createTemplatesPage([createTemplate(1, { title: "Тяжёлый шаблон" })]));
  });

  it("triggers a background refresh when returning to templates with a refresh state", async () => {
    const queryClient = createQueryClient();
    const templatesQueryKey = getTemplateFormsQueryKey({
      section: "mine",
      pageSize: 24,
      userId: "user-1",
    });

    queryClient.setQueryData(
      templatesQueryKey,
      createTemplatesPage([createTemplate(1, { title: "Кэшированный шаблон" })]),
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

  it("keeps the template preview drawer wide enough for the survey page layout", () => {
    const css = readAppCss();

    expect(css).toMatch(/\.template-preview-drawer\s*\{[^}]*width:\s*min\(820px,\s*calc\(100vw - 32px\)\);/);
    expect(css).toMatch(/\.template-preview-drawer\s*\{[^}]*overflow-y:\s*auto;[^}]*overflow-x:\s*clip;/);
    expect(css).toMatch(/\.template-preview-body\.survey-page-card\s*\{[^}]*width:\s*100%;[^}]*max-width:\s*100%;[^}]*min-width:\s*0;[^}]*overflow:\s*visible;/);
  });

  it("uses a gray border for template action menu trigger buttons", () => {
    const css = readAppCss();

    expect(css).toContain(".form-menu-trigger {");
    expect(css).toContain("border: 2px solid rgba(100, 116, 139, 0.52);");
    expect(css).toContain("border-color: rgba(100, 116, 139, 0.72);");
    expect(css).not.toContain("border: 2px solid rgba(20, 20, 20, 0.72);");
  });

  it("matches template card border thickness with dashboard form cards", () => {
    const css = readAppCss();

    expect(css).toMatch(/\.dashboard-forms-grid > \.dashboard-form-card\s*\{[^}]*border:\s*2px solid rgba\(20,\s*20,\s*20,\s*0\.14\);/);
    expect(css).toMatch(/\.templates-gallery-grid > \.templates-card\s*\{[^}]*border:\s*2px solid rgba\(20,\s*20,\s*20,\s*0\.14\);/);
  });
});
