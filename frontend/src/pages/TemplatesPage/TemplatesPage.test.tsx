import { readFileSync } from "node:fs";
import { join } from "node:path";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { routes } from "../../app/routes";
import type { SurveyForm } from "../../entities/survey/types";
import TemplatesPage from "./TemplatesPage";

const {
  changeFormStatus,
  createFormFromTemplate,
  getForms,
  navigate,
  removeForm,
  renameForm,
  showToast,
} = vi.hoisted(() => ({
  changeFormStatus: vi.fn(),
  createFormFromTemplate: vi.fn(),
  getForms: vi.fn(),
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
  getForms,
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

function renderPage(queryClient = createQueryClient()) {
  const renderResult = render(
    <MemoryRouter>
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
    vi.clearAllMocks();
    changeFormStatus.mockResolvedValue(undefined);
    createFormFromTemplate.mockResolvedValue({ id: "created-from-template" });
    removeForm.mockResolvedValue(undefined);
    renameForm.mockResolvedValue(undefined);
  });

  it("renders my templates as a two-column gallery and opens a preview drawer from a card", async () => {
    getForms.mockResolvedValue([
      createTemplate(1, { title: "Заявка на конкурс" }),
      createTemplate(2, { title: "Анкета участника" }),
      createTemplate(3, { title: "Обычная форма", form_type: "anketa" }),
    ]);

    const { container } = renderPage();

    expect(await screen.findByText("Заявка на конкурс")).toBeInTheDocument();
    expect(screen.getByText("Анкета участника")).toBeInTheDocument();
    expect(screen.queryByText("Обычная форма")).not.toBeInTheDocument();
    expect(container.querySelector(".templates-gallery-grid")).toBeInTheDocument();
    expect(container.querySelector(".templates-gallery-grid")).toHaveClass("templates-gallery-grid-two-columns");

    await userEvent.click(screen.getByRole("button", { name: "Открыть превью шаблона Заявка на конкурс" }));

    expect(await screen.findByRole("dialog", { name: "Превью шаблона Заявка на конкурс" })).toBeInTheDocument();
    expect(container.querySelector(".template-preview-body")).toHaveClass("survey-page-card");
    expect(screen.getByTestId("template-preview-renderer")).toHaveAttribute("data-preview", "true");
  });

  it("uses a selected template to create a regular form and open it in the builder", async () => {
    getForms.mockResolvedValue([createTemplate(1, { title: "Шаблон заявки" })]);

    renderPage();

    await userEvent.click(await screen.findByRole("button", { name: "Использовать шаблон Шаблон заявки" }));

    await waitFor(() => {
      expect(createFormFromTemplate).toHaveBeenCalledWith(expect.objectContaining({ id: "template-1" }), "user-1");
    });
    expect(navigate).toHaveBeenCalledWith(routes.builderEdit("created-from-template"));
  });

  it("offers template actions without creating a new form when editing", async () => {
    getForms.mockResolvedValue([createTemplate(1, { title: "Мой шаблон" })]);

    const { container } = renderPage();

    await userEvent.click(await screen.findByRole("button", { name: "Действия шаблона Мой шаблон" }));

    expect(container.querySelector(".templates-gallery-grid")).toHaveClass("templates-gallery-grid-menu-open");

    const menu = await screen.findByRole("menu", { name: "Меню действий шаблона Мой шаблон" });
    expect(menu).toHaveClass("templates-menu-dropdown");
    expect(within(menu).getByRole("menuitem", { name: "Переименовать" })).toBeInTheDocument();
    expect(within(menu).getByRole("menuitem", { name: "Редактировать" })).toBeInTheDocument();
    expect(within(menu).getByRole("menuitem", { name: "Удалить" })).toBeInTheDocument();

    await userEvent.click(within(menu).getByRole("menuitem", { name: "Редактировать" }));

    expect(navigate).toHaveBeenCalledWith(routes.builderEdit("template-1"));
    expect(createFormFromTemplate).not.toHaveBeenCalled();
  });

  it("toggles publishing for my templates and shows author metadata for public templates", async () => {
    getForms.mockImplementation((filters: { authorId?: string } | undefined) =>
      Promise.resolve(
        filters?.authorId
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
    );

    const { container } = renderPage();

    await userEvent.click(await screen.findByRole("button", { name: "Поделиться шаблоном Закрытый шаблон" }));

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
    getForms.mockResolvedValue([
      createTemplate(1, {
        title: "Опубликованный шаблон",
        is_public: true,
      }),
    ]);

    renderPage();

    expect(await screen.findByRole("button", { name: "Не показывать другим шаблоном Опубликованный шаблон" })).toHaveClass(
      "templates-share-button-muted",
    );
  });

  it("keeps the template preview drawer wide enough for the survey page layout", () => {
    expect(readAppCss()).toContain("width: min(820px, calc(100vw - 32px));");
  });
});
