import { readFileSync } from "node:fs";
import { join } from "node:path";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { routes } from "../../app/routes";
import { SurveyBuilder } from "./SurveyBuilder";
import { getSurveyBuilderDraftStorageKey } from "./builderDraft";
import type { SurveySchema } from "../../entities/survey/types";

const DEFAULT_SURVEY_LOGO_TOKEN = "__APP_DEFAULT_CARD_LOGO__";

const {
  componentCollectionAdd,
  componentCollectionGetByName,
  createSurveyMutateAsync,
  creatorInstances,
  getFormById,
  getForms,
  navigate,
  saveSurveySchema,
  serializerGetProperty,
  serializerInputTypeProp,
  setFormDeadline,
  setFormResponseLimit,
  showToast,
} = vi.hoisted(() => ({
  componentCollectionAdd: vi.fn(),
  componentCollectionGetByName: vi.fn(),
  createSurveyMutateAsync: vi.fn(),
  creatorInstances: [] as any[],
  getFormById: vi.fn(),
  getForms: vi.fn(),
  navigate: vi.fn(),
  saveSurveySchema: vi.fn(),
  serializerGetProperty: vi.fn(),
  serializerInputTypeProp: { visible: true },
  setFormDeadline: vi.fn(),
  setFormResponseLimit: vi.fn(),
  showToast: vi.fn(),
}));

class FakeEvent {
  private handlers: Array<(sender: unknown, options: unknown) => void> = [];

  add(handler: (sender: unknown, options: unknown) => void) {
    this.handlers.push(handler);
  }

  remove(handler: (sender: unknown, options: unknown) => void) {
    this.handlers = this.handlers.filter((item) => item !== handler);
  }

  fire(sender: unknown, options: unknown) {
    this.handlers.forEach((handler) => handler(sender, options));
  }
}

vi.mock("../../app/providers/AuthProvider", () => ({
  useAuth: () => ({
    user: { id: "user-1" },
  }),
}));

vi.mock("../../app/providers/ToastProvider", () => ({
  useToast: () => ({
    showToast,
  }),
}));

vi.mock("../../features/create-survey/useCreateSurvey", () => ({
  useCreateSurveyMutation: () => ({
    isPending: false,
    mutateAsync: createSurveyMutateAsync,
  }),
}));

vi.mock("../../entities/survey/api/surveysApi", () => ({
  getFormById,
  getForms,
  saveSurveySchema,
  setFormDeadline,
  setFormResponseLimit,
}));

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");

  return {
    ...actual,
    useNavigate: () => navigate,
  };
});

vi.mock("survey-creator-core", () => ({
  editorLocalization: {
    currentLocale: "ru",
    getLocaleStrings: () => ({
      ed: {},
      tabs: {},
    }),
  },
}));

vi.mock("survey-core", () => ({
  ComponentCollection: {
    Instance: {
      add: componentCollectionAdd,
      getCustomQuestionByName: componentCollectionGetByName,
    },
  },
  Serializer: {
    getProperty: serializerGetProperty,
  },
  SvgRegistry: {
    registerIconFromSvg: vi.fn(),
  },
  surveyLocalization: {
    defaultLocale: "ru",
  },
}));

vi.mock("survey-creator-react", () => {
  class FakeSurveyCreator {
    allowCollapseSidebar = false;
    showSidebar = true;
    locale = "ru";
    JSON: SurveySchema & { questionDescriptionLocation?: string } = {
      title: "Новая форма",
      locale: "ru",
      questionDescriptionLocation: "underTitle",
      pages: [{ name: "page1", title: "", elements: [] }],
      logo: DEFAULT_SURVEY_LOGO_TOKEN,
      logoWidth: "120px",
      logoHeight: "90px",
      logoFit: "contain",
    };
    options: Record<string, unknown>;
    onElementAllowOperations = new FakeEvent();
    onSurveyInstanceCreated = new FakeEvent();
    onModified = new FakeEvent();
    onQuestionAdded = new FakeEvent();
    saveSurveyFunc: ((saveNo: number, callback: (saveNo: number, isSuccess: boolean) => void) => void) | undefined;
    toolbox = {
      items: [] as Array<Record<string, unknown>>,
      categories: [
        { name: "basic", title: "basic" },
        { name: "advanced", title: "advanced" },
      ],
      showCategoryTitles: false,
      clearItems: vi.fn(),
      getItemByName: vi.fn((name: string) => this.toolbox.items.find((item) => item.name === name) ?? null),
      addItem: vi.fn((item: Record<string, unknown>, index?: number) => {
        if (index === undefined || index < 0 || index >= this.toolbox.items.length) {
          this.toolbox.items.push(item);
          return;
        }

        this.toolbox.items.splice(index, 0, item);
      }),
    };
    toolbar = {
      actions: [] as Array<Record<string, unknown>>,
      addAction: (action: Record<string, unknown>, _visible?: boolean) => {
        this.toolbar.actions.push(action);
      },
      getActionById: (id: string) => this.toolbar.actions.find((action) => action.id === id),
    };

    constructor(options: Record<string, unknown>) {
      this.options = options;
      creatorInstances.push(this);
    }

    dispose = vi.fn();
  }

  return {
    SurveyCreator: FakeSurveyCreator,
    SurveyCreatorComponent: ({ creator }: { creator: FakeSurveyCreator }) => (
      <div data-testid="survey-creator">{creator.JSON.title}</div>
    ),
  };
});

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: { retry: false },
    },
  });
}

function renderBuilder(formId?: string) {
  return render(
    <MemoryRouter>
      <QueryClientProvider client={createQueryClient()}>
        <SurveyBuilder formId={formId} />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

function readAppCss() {
  return readFileSync(join(process.cwd(), "src/app.css"), "utf8");
}

function createTemplateForm(overrides: Partial<SurveySchema & { id: string; title: string }> = {}) {
  return {
    id: "template-1",
    title: "Редактируемый шаблон",
    created_at: "2026-04-15T10:00:00.000Z",
    is_public: false,
    author_id: "user-1",
    author_name: "Я",
    author_email: "me@example.com",
    form_type: "template",
    form_reason: "plan",
    deadline_at: null,
    max_responses: null,
    responses_count: 0,
    schema: {
      title: "Редактируемый шаблон",
      locale: "ru",
      pages: [{ name: "page1", elements: [{ type: "text", name: "q1", title: "Вопрос" }] }],
    },
    ...overrides,
  };
}

describe("SurveyBuilder", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    creatorInstances.length = 0;
    componentCollectionGetByName.mockReturnValue(undefined);
    serializerGetProperty.mockReturnValue(serializerInputTypeProp);
    serializerInputTypeProp.visible = true;
    getFormById.mockResolvedValue(null);
    getForms.mockResolvedValue([]);
    saveSurveySchema.mockResolvedValue(undefined);
    setFormDeadline.mockResolvedValue(undefined);
    setFormResponseLimit.mockResolvedValue(undefined);
    createSurveyMutateAsync.mockResolvedValue({ id: "created-form-id" });
  });

  it("restores a saved draft and persists later changes", async () => {
    const initialDraft: SurveySchema = {
      title: "Черновик",
      locale: "ru",
      pages: [{ name: "page1", elements: [{ type: "text", name: "q1", title: "Вопрос" }] }],
    };

    localStorage.setItem(
      getSurveyBuilderDraftStorageKey(),
      JSON.stringify({
        schema: initialDraft,
        updatedAt: "2026-04-09T10:00:00.000Z",
      }),
    );

    renderBuilder();

    await waitFor(() => {
      expect(creatorInstances).toHaveLength(1);
    });

    expect(creatorInstances[0].JSON).toMatchObject(initialDraft);

    const updatedDraft: SurveySchema = {
      title: "Обновлённый черновик",
      locale: "ru",
      pages: [{ name: "page1", elements: [{ type: "text", name: "q2", title: "Новый вопрос" }] }],
    };

    act(() => {
      creatorInstances[0].JSON = updatedDraft;
      creatorInstances[0].onModified.fire(creatorInstances[0], { type: "PROPERTY_CHANGED" });
    });

    expect(JSON.parse(localStorage.getItem(getSurveyBuilderDraftStorageKey()) ?? "{}")).toMatchObject({
      schema: updatedDraft,
    });
  });

  it("opens reset confirmation and clears the builder to an empty draft", async () => {
    const initialDraft: SurveySchema = {
      title: "Черновик",
      locale: "ru",
      pages: [{ name: "page1", elements: [{ type: "text", name: "q1", title: "Вопрос" }] }],
    };

    localStorage.setItem(
      getSurveyBuilderDraftStorageKey(),
      JSON.stringify({
        schema: initialDraft,
        updatedAt: "2026-04-09T10:00:00.000Z",
      }),
    );

    renderBuilder();

    await waitFor(() => {
      expect(creatorInstances).toHaveLength(1);
    });

    act(() => {
      const resetAction = creatorInstances[0].toolbar.getActionById("builder-reset") as { action: () => void };
      resetAction.action();
    });

    expect(await screen.findByRole("heading", { name: "Сбросить конструктор?" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Сбросить" }));

    await waitFor(() => {
      expect(creatorInstances[0].JSON).toMatchObject({
        title: "Новая форма",
        logoWidth: "120px",
        logoHeight: "90px",
        logoFit: "contain",
        pages: [{ name: "page1", title: "", elements: [] }],
      });
      expect(creatorInstances[0].JSON.logo).not.toBe(DEFAULT_SURVEY_LOGO_TOKEN);
    });

    expect(JSON.parse(localStorage.getItem(getSurveyBuilderDraftStorageKey()) ?? "{}")).toMatchObject({
      schema: expect.objectContaining({
        title: "Новая форма",
        logo: DEFAULT_SURVEY_LOGO_TOKEN,
        logoWidth: "120px",
        logoHeight: "90px",
        logoFit: "contain",
        pages: [{ name: "page1", title: "", elements: [] }],
      }),
    });
  });

  it("configures creator with one question type whitelist for toolbox and type conversion", async () => {
    renderBuilder();

    await waitFor(() => {
      expect(creatorInstances).toHaveLength(1);
    });

    const creator = creatorInstances[0];

    expect(creator.allowCollapseSidebar).toBe(true);
    expect(creator.showSidebar).toBe(false);
    expect(creator.JSON).toMatchObject({
      title: "Новая форма",
      locale: "ru",
      questionDescriptionLocation: "underTitle",
      logoWidth: "120px",
      logoHeight: "90px",
      logoFit: "contain",
      pages: [{ name: "page1", title: "", elements: [] }],
    });
    expect(creator.JSON.logo).not.toBe(DEFAULT_SURVEY_LOGO_TOKEN);
    expect(screen.queryByRole("button", { name: "Сбросить конструктор" })).not.toBeInTheDocument();
    expect(creator.toolbar.actions.map((action: { id: string }) => action.id)).toEqual([
      "builder-reset",
      "builder-save-template",
    ]);

    const questionTypes = [
      "text",
      "comment",
      "radiogroup",
      "checkbox",
      "dropdown",
      "number",
      "integer",
      "date",
      "time",
      "datetime",
      "phone",
      "email",
      "boolean",
      "rating",
      "ranking",
      "tagbox",
      "matrix",
      "matrixdropdown",
      "matrixdynamic",
      "multipletext",
      "image",
      "imagepicker",
      "file",
      "signaturepad",
      "panel",
      "paneldynamic",
      "expression",
      "html",
    ];

    expect(creator.options.questionTypes).toEqual(questionTypes);
    expect(creator.toolbox.items.map((item: { name: string }) => item.name)).toEqual(questionTypes);
    expect(creator.toolbox.getItemByName("text")?.items).toEqual([]);
    expect(serializerGetProperty).toHaveBeenCalledWith("text", "inputType");
    expect(serializerInputTypeProp.visible).toBe(false);
    expect(componentCollectionAdd).toHaveBeenCalledTimes(7);
    expect(componentCollectionAdd).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "email",
        questionJSON: expect.objectContaining({
          type: "text",
          inputType: "email",
        }),
        inheritBaseProps: true,
      }),
    );
    expect(componentCollectionAdd).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "integer",
        questionJSON: expect.objectContaining({
          type: "text",
          inputType: "number",
        }),
        inheritBaseProps: true,
      }),
    );

    const textOptions = {
      obj: {
        getType: () => "text",
      },
      allowChangeType: false,
      allowChangeInputType: true,
    };

    creator.onElementAllowOperations.fire(creator, textOptions);

    expect(textOptions.allowChangeType).toBe(true);
    expect(textOptions.allowChangeInputType).toBe(false);

    const unsupportedOptions = {
      obj: {
        getType: () => "unsupported-custom-type",
      },
      allowChangeType: true,
      allowChangeInputType: false,
    };

    creator.onElementAllowOperations.fire(creator, unsupportedOptions);

    expect(unsupportedOptions.allowChangeType).toBe(false);
    expect(unsupportedOptions.allowChangeInputType).toBe(false);

    const previewSurvey = {
      applyTheme: vi.fn(),
    };
    const designerSurvey = {
      applyTheme: vi.fn(),
      onPageAdded: new FakeEvent(),
    };
    const logicSurvey = {
      applyTheme: vi.fn(),
    };

    act(() => {
      creator.onSurveyInstanceCreated.fire(creator, {
        area: "designer-tab",
        survey: designerSurvey,
      });
      creator.onSurveyInstanceCreated.fire(creator, {
        area: "preview-tab",
        survey: previewSurvey,
      });
      creator.onSurveyInstanceCreated.fire(creator, {
        area: "logic-tab",
        survey: logicSurvey,
      });
    });

    expect(designerSurvey.applyTheme).toHaveBeenCalledWith(
      expect.objectContaining({
        themeName: "defaultV2",
        cssVariables: expect.objectContaining({
          "--sjs-primary-backcolor": "#121212",
          "--sjs-primary-backcolor-dark": "#000000",
        }),
      }),
    );
    expect(previewSurvey.applyTheme).toHaveBeenCalledWith(
      expect.objectContaining({
        themeName: "defaultV2",
        cssVariables: expect.objectContaining({
          "--sjs-primary-backcolor": "#121212",
          "--sjs-primary-backcolor-dark": "#000000",
        }),
      }),
    );
    expect(logicSurvey.applyTheme).not.toHaveBeenCalled();

    const autoNamedPage = {
      page: {
        name: "page2",
        title: "Страница 2",
      },
    };

    act(() => {
      designerSurvey.onPageAdded.fire(designerSurvey, autoNamedPage);
    });

    expect(autoNamedPage.page.title).toBe("");

    const question = {} as { isRequired?: boolean; descriptionLocation?: string };

    act(() => {
      creator.onQuestionAdded.fire(creator, { question });
    });

    expect(question).toMatchObject({
      isRequired: true,
      descriptionLocation: "underTitle",
    });
  });

  it("keeps the final surveyjs builder override block at the end of app.css", () => {
    const appCss = readAppCss();
    const finalOverrideIndex = appCss.lastIndexOf("FINAL SurveyJS Builder override");

    expect(finalOverrideIndex).toBeGreaterThan(appCss.lastIndexOf("@media (max-width: 760px)"));

    const finalOverride = appCss.slice(finalOverrideIndex);

    expect(finalOverride).toContain(".builder-creator-shell .svc-creator .sd-body");
    expect(finalOverride).toContain(".builder-creator-shell .spg-button-group__item {");
    expect(finalOverride).toContain("transform 140ms ease");
    expect(finalOverride).toContain(".survey-page-card .sd-question__description");
    expect(finalOverride).toContain("background: rgba(219, 234, 254, 0.88) !important;");
    expect(finalOverride).toContain("color: #141414 !important;");
    expect(finalOverride).toContain("padding: 4px 8px;");
    expect(finalOverride).toContain(".builder-creator-shell .sd-description,");
    expect(finalOverride).toContain("white-space: normal !important;");
    expect(finalOverride).toContain("font-size: 1.06rem !important;");
    expect(finalOverride).toContain("font-size: 0.88rem !important;");
    expect(finalOverride).toContain(".dashboard-status-dropdown");
    expect(finalOverride).toContain("background: #ffffff !important;");
  });

  it("uses a two-column metadata grid with green save and red cancel actions in the post-save settings dialog", () => {
    const appCss = readAppCss();

    expect(appCss).toMatch(/\.deadline-modal-primary-grid\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\);/);
    expect(appCss).toMatch(/\.deadline-save-button\s*\{[^}]*background:\s*linear-gradient\(180deg,\s*#22c55e,\s*#15803d\);[^}]*color:\s*#ffffff;/);
    expect(appCss).toMatch(/\.deadline-clear-button\s*\{[^}]*background:\s*rgba\(254,\s*226,\s*226,\s*0\.8\);[^}]*color:\s*#b91c1c;/);
  });

  it("opens response settings before creating a form and publishes it only after saving the dialog", async () => {
    renderBuilder();

    await waitFor(() => {
      expect(creatorInstances).toHaveLength(1);
    });

    const callback = vi.fn();

    await act(async () => {
      await creatorInstances[0].saveSurveyFunc?.(1, callback);
    });

    expect(callback).toHaveBeenCalledWith(1, true);
    expect(navigate).not.toHaveBeenCalledWith(routes.dashboardMy, { replace: true });
    expect(createSurveyMutateAsync).not.toHaveBeenCalled();

    const settingsDialog = await screen.findByRole("dialog", { name: "Настройки формы" });
    expect(within(settingsDialog).getByLabelText("Тип формы")).toBeInTheDocument();
    expect(within(settingsDialog).getByLabelText("Основание формы")).toBeInTheDocument();
    expect(within(settingsDialog).queryByRole("button", { name: "Пропустить" })).not.toBeInTheDocument();

    await userEvent.selectOptions(within(settingsDialog).getByLabelText("Тип формы"), "monitoring");
    await userEvent.selectOptions(within(settingsDialog).getByLabelText("Основание формы"), "order");
    await userEvent.type(within(settingsDialog).getByLabelText("Дедлайн"), "2026-05-01T12:30");
    await userEvent.clear(within(settingsDialog).getByLabelText("Лимит ответов"));
    await userEvent.type(within(settingsDialog).getByLabelText("Лимит ответов"), "25");
    await userEvent.click(within(settingsDialog).getByRole("button", { name: "Сохранить" }));

    await waitFor(() => {
      expect(createSurveyMutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Новая форма",
          formType: "monitoring",
          formReason: "order",
          isPublic: true,
          deadlineAt: new Date("2026-05-01T12:30").toISOString(),
          maxResponses: 25,
        }),
      );
    });
    expect(setFormDeadline).not.toHaveBeenCalled();
    expect(setFormResponseLimit).not.toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith(routes.dashboardMy, { replace: true, state: { refreshList: true } });
  });

  it("closes the post-save settings dialog without resetting the builder when the user cancels", async () => {
    renderBuilder();

    await waitFor(() => {
      expect(creatorInstances).toHaveLength(1);
    });

    act(() => {
      creatorInstances[0].JSON = {
        title: "Черновая форма",
        locale: "ru",
        pages: [{ name: "page1", elements: [{ type: "text", name: "q1", title: "Вопрос" }] }],
      };
      creatorInstances[0].onModified.fire(creatorInstances[0], { type: "PROPERTY_CHANGED" });
    });

    expect(JSON.parse(localStorage.getItem(getSurveyBuilderDraftStorageKey()) ?? "{}")).toMatchObject({
      schema: expect.objectContaining({
        title: "Черновая форма",
      }),
    });

    const callback = vi.fn();

    await act(async () => {
      await creatorInstances[0].saveSurveyFunc?.(1, callback);
    });

    const settingsDialog = await screen.findByRole("dialog", { name: "Настройки формы" });
    await userEvent.click(within(settingsDialog).getByRole("button", { name: "Отмена" }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Настройки формы" })).not.toBeInTheDocument();
    });

    expect(createSurveyMutateAsync).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
    expect(creatorInstances[0].JSON).toMatchObject({
      title: "Черновая форма",
      pages: [{ name: "page1", elements: [{ type: "text", name: "q1", title: "Вопрос" }] }],
    });
    expect(JSON.parse(localStorage.getItem(getSurveyBuilderDraftStorageKey()) ?? "{}")).toMatchObject({
      schema: expect.objectContaining({
        title: "Черновая форма",
      }),
    });
  });

  it("returns to the templates page with a refresh state after saving an existing template", async () => {
    getFormById.mockResolvedValue(createTemplateForm({ id: "template-7", title: "Шаблон для правки" }) as never);

    renderBuilder("template-7");

    await waitFor(() => {
      expect(creatorInstances).toHaveLength(1);
      expect(getFormById).toHaveBeenCalledWith("template-7");
    });

    await waitFor(() => {
      expect(creatorInstances[0].JSON).toMatchObject({
        title: "Шаблон для правки",
      });
    });

    const callback = vi.fn();

    await act(async () => {
      await creatorInstances[0].saveSurveyFunc?.(1, callback);
    });

    expect(callback).toHaveBeenCalledWith(1, true);
    expect(saveSurveySchema).toHaveBeenCalledWith(
      "template-7",
      expect.objectContaining({
        title: "Шаблон для правки",
      }),
      "Шаблон для правки",
    );
    expect(navigate).toHaveBeenCalledWith(routes.templates, { replace: true, state: { refreshList: true } });
  });

  it("saves the current builder draft as a template, clears it, and opens the templates page", async () => {
    renderBuilder();

    await waitFor(() => {
      expect(creatorInstances).toHaveLength(1);
    });

    act(() => {
      creatorInstances[0].JSON = {
        title: "Шаблон из конструктора",
        locale: "ru",
        pages: [{ name: "page1", elements: [{ type: "text", name: "q1", title: "Вопрос" }] }],
      };
      creatorInstances[0].onModified.fire(creatorInstances[0], { type: "PROPERTY_CHANGED" });
    });

    expect(localStorage.getItem(getSurveyBuilderDraftStorageKey())).not.toBeNull();

    await act(async () => {
      const saveTemplateAction = creatorInstances[0].toolbar.getActionById("builder-save-template") as { action: () => void };
      await saveTemplateAction.action();
    });

    await waitFor(() => {
      expect(createSurveyMutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Шаблон из конструктора",
          formType: "template",
          isPublic: false,
        }),
      );
    });

    expect(localStorage.getItem(getSurveyBuilderDraftStorageKey())).toBeNull();
    expect(navigate).toHaveBeenCalledWith(routes.templates, { replace: true, state: { refreshList: true } });
  });
});
