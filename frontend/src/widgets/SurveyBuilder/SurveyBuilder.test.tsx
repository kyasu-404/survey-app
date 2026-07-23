import { readFileSync } from "node:fs";
import { join } from "node:path";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { routes } from "../../app/routes";
import { SurveyBuilder } from "./SurveyBuilder";
import { getBuilderPreviewSnapshot } from "./builderPreviewBridge";
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
  serializerProperties,
  setFormDeadline,
  setFormResponseLimit,
  showToast,
  surveyFormRendererProps,
  registerElement,
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
  serializerProperties: {} as Record<string, { visible: boolean }>,
  setFormDeadline: vi.fn(),
  setFormResponseLimit: vi.fn(),
  showToast: vi.fn(),
  surveyFormRendererProps: [] as Array<{
    formId: string;
    renderMode?: string;
    schema: SurveySchema;
    theme?: Record<string, unknown>;
  }>,
  registerElement: vi.fn(),
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

vi.mock("../../features/render-form/SurveyFormRenderer", () => ({
  SurveyFormRenderer: (props: { formId: string; renderMode?: string; schema: SurveySchema; theme?: Record<string, unknown> }) => {
    surveyFormRendererProps.push(props);

    return (
      <div
        data-testid="survey-form-renderer"
        data-form-id={props.formId}
        data-render-mode={props.renderMode ?? ""}
      >
        {props.schema.title}
      </div>
    );
  },
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

vi.mock("survey-react-ui", () => ({
  ReactElementFactory: {
    Instance: {
      isElementRegistered: vi.fn(() => false),
      registerElement,
    },
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
    activeTab = "designer";
    theme: Record<string, unknown> = {};
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
    onActiveTabChanged = new FakeEvent();
    onUploadFile = new FakeEvent();
    onQuestionAdded = new FakeEvent();
    themeEditor = {
      onThemePropertyChanged: new FakeEvent(),
      onThemeSelected: new FakeEvent(),
    };
    saveSurveyFunc: ((saveNo: number, callback: (saveNo: number, isSuccess: boolean) => void) => void) | undefined;
    saveThemeFunc: ((saveNo: number, callback: (saveNo: number, isSuccess: boolean) => void) => void) | undefined;
    tabs: Array<Record<string, unknown>> = [];
    plugins: Record<string, unknown> = {};
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

    addPluginTab = vi.fn(
      (name: string, plugin: unknown, title?: string, componentName?: string, index?: number) => {
        this.tabs.splice(index ?? this.tabs.length, 0, { id: name, plugin, title, componentName, index });
        this.plugins[name] = plugin;
      },
    );
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
        <SurveyBuilder formId={formId} userId="user-1" />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

function readAppCss() {
  return readFileSync(join(process.cwd(), "src/app.css"), "utf8");
}

function readSurveyBuilderSource() {
  return readFileSync(join(process.cwd(), "src/widgets/SurveyBuilder/SurveyBuilder.tsx"), "utf8");
}

function createTemplateForm(overrides: Partial<SurveySchema & { id: string; title: string; schema: SurveySchema }> = {}) {
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
    theme: {},
    ...overrides,
  };
}

describe("SurveyBuilder", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    creatorInstances.length = 0;
    componentCollectionGetByName.mockReturnValue(undefined);
    Object.keys(serializerProperties).forEach((key) => {
      delete serializerProperties[key];
    });
    serializerGetProperty.mockImplementation((type: string, name: string) => {
      const key = `${type}:${name}`;
      if (!serializerProperties[key]) {
        serializerProperties[key] = { visible: true };
      }

      return name === "inputType" ? serializerInputTypeProp : serializerProperties[key];
    });
    serializerInputTypeProp.visible = true;
    getFormById.mockResolvedValue(null);
    getForms.mockResolvedValue([]);
    saveSurveySchema.mockResolvedValue(undefined);
    setFormDeadline.mockResolvedValue(undefined);
    setFormResponseLimit.mockResolvedValue(undefined);
    createSurveyMutateAsync.mockResolvedValue({ id: "created-form-id" });
    surveyFormRendererProps.length = 0;
    registerElement.mockClear();
  });

  it("restores a saved draft and persists later changes", async () => {
    const initialDraft: SurveySchema = {
      title: "Черновик",
      showQuestionNumbers: true,
      locale: "ru",
      pages: [
        {
          name: "page1",
          elements: [
            {
              type: "text",
              name: "q1",
              title: "Вопрос",
              showNumber: true,
              hideNumber: true,
            },
            {
              type: "panel",
              name: "panel1",
              title: "Панель",
              showQuestionNumbers: "on",
              elements: [
                {
                  type: "text",
                  name: "nested",
                  title: "Вложенный вопрос",
                  showNumber: true,
                },
              ],
            },
          ],
        },
      ],
    };

    localStorage.setItem(
      getSurveyBuilderDraftStorageKey("user-1"),
      JSON.stringify({
        schema: initialDraft,
        ownerId: "user-1",
        updatedAt: new Date().toISOString(),
      }),
    );

    renderBuilder();

    await waitFor(() => {
      expect(creatorInstances).toHaveLength(1);
    });

    expect(creatorInstances[0].JSON).toMatchObject({
      title: "Черновик",
      locale: "ru",
      showQuestionNumbers: false,
      pages: [
        {
          name: "page1",
          elements: [
            {
              type: "text",
              name: "q1",
              title: "Вопрос",
              showNumber: false,
            },
            {
              type: "panel",
              name: "panel1",
              title: "Панель",
              showNumber: false,
              showQuestionNumbers: "off",
              elements: [
                {
                  type: "text",
                  name: "nested",
                  title: "Вложенный вопрос",
                  showNumber: false,
                },
              ],
            },
          ],
        },
      ],
    });
    expect(
      ((creatorInstances[0].JSON.pages?.[0]?.elements?.[0] ?? {}) as { hideNumber?: boolean }).hideNumber,
    ).toBeUndefined();

    const updatedDraft: SurveySchema = {
      title: "Обновлённый черновик",
      showQuestionNumbers: true,
      locale: "ru",
      pages: [
        {
          name: "page1",
          elements: [
            {
              type: "text",
              name: "q2",
              title: "Новый вопрос",
              showNumber: true,
              hideNumber: true,
            },
          ],
        },
      ],
    };

    act(() => {
      creatorInstances[0].JSON = updatedDraft;
      creatorInstances[0].onModified.fire(creatorInstances[0], { type: "PROPERTY_CHANGED" });
    });

    expect(JSON.parse(localStorage.getItem(getSurveyBuilderDraftStorageKey("user-1")) ?? "{}")).toMatchObject({
      schema: {
        title: "Обновлённый черновик",
        locale: "ru",
        showQuestionNumbers: false,
        pages: [
          {
            name: "page1",
            elements: [
              {
                type: "text",
                name: "q2",
                title: "Новый вопрос",
                showNumber: false,
              },
            ],
          },
        ],
      },
    });
  });

  it("opens reset confirmation and clears the builder to an empty draft", async () => {
    const initialDraft: SurveySchema = {
      title: "Черновик",
      locale: "ru",
      pages: [{ name: "page1", elements: [{ type: "text", name: "q1", title: "Вопрос" }] }],
    };

    localStorage.setItem(
      getSurveyBuilderDraftStorageKey("user-1"),
      JSON.stringify({
        schema: initialDraft,
        ownerId: "user-1",
        updatedAt: new Date().toISOString(),
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

    expect(JSON.parse(localStorage.getItem(getSurveyBuilderDraftStorageKey("user-1")) ?? "{}")).toMatchObject({
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
    expect(creator.showSidebar).toBe(true);
    expect(creator.options).toMatchObject({
      propertyGridNavigationMode: "accordion",
      previewAllowHiddenElements: false,
      previewAllowSelectLanguage: false,
      previewAllowSelectPage: true,
      previewAllowSimulateDevices: true,
      showDesignerTab: true,
      showCreatorThemeSettings: false,
      showJSONEditorTab: false,
      showLogicTab: true,
      showPreviewTab: false,
      showSurveyHeader: true,
      showThemeTab: true,
      showTranslationTab: false,
    });
    expect(creator.JSON).toMatchObject({
      title: "Новая форма",
      locale: "ru",
      showQuestionNumbers: false,
      questionDescriptionLocation: "underTitle",
      completedHtml: expect.stringContaining("Спасибо за Ваш ответ!"),
      logoWidth: "120px",
      logoHeight: "90px",
      logoFit: "contain",
      pages: [{ name: "page1", title: "", elements: [] }],
    });
    expect(creator.JSON.logo).not.toBe(DEFAULT_SURVEY_LOGO_TOKEN);
    expect(screen.queryByRole("button", { name: "Сбросить конструктор" })).not.toBeInTheDocument();
    expect(creator.toolbar.actions.map((action: { id: string }) => action.id)).toEqual([
      "builder-background-gallery",
      "builder-reset",
      "builder-save-template",
    ]);
    expect(creator.toolbar.actions.find((action: { id: string }) => action.id === "builder-reset")).toMatchObject({
      css: "builder-toolbar-action-item",
      innerCss: "builder-toolbar-action-button",
    });
    expect(creator.toolbar.actions.find((action: { id: string }) => action.id === "builder-reset")).not.toMatchObject({
      disableShrink: true,
    });
    expect(creator.toolbar.actions.find((action: { id: string }) => action.id === "builder-save-template")).toMatchObject({
      css: "builder-toolbar-action-item",
      innerCss: "builder-toolbar-action-button",
    });
    expect(creator.toolbar.actions.find((action: { id: string }) => action.id === "builder-save-template")).not.toMatchObject({
      disableShrink: true,
    });
    expect(creator.addPluginTab).toHaveBeenCalledWith(
      "runtime-preview",
      expect.objectContaining({
        activate: expect.any(Function),
        deactivate: expect.any(Function),
        model: creator,
      }),
      "Превью",
      "svc-tab-runtime-preview",
      1,
    );

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
    expect(serializerGetProperty).toHaveBeenCalledWith("survey", "showQuestionNumbers");
    expect(serializerGetProperty).toHaveBeenCalledWith("survey", "questionStartIndex");
    expect(serializerGetProperty).toHaveBeenCalledWith("survey", "questionTitlePattern");
    expect(serializerGetProperty).toHaveBeenCalledWith("question", "showNumber");
    expect(serializerGetProperty).toHaveBeenCalledWith("question", "hideNumber");
    expect(serializerGetProperty).toHaveBeenCalledWith("panel", "showNumber");
    expect(serializerGetProperty).toHaveBeenCalledWith("panel", "showQuestionNumbers");
    expect(serializerGetProperty).toHaveBeenCalledWith("paneldynamic", "showNumber");
    expect(serializerGetProperty).toHaveBeenCalledWith("paneldynamic", "showQuestionNumbers");
    expect(serializerInputTypeProp.visible).toBe(false);
    expect(serializerProperties["survey:showQuestionNumbers"]?.visible).toBe(false);
    expect(serializerProperties["survey:questionStartIndex"]?.visible).toBe(false);
    expect(serializerProperties["survey:questionTitlePattern"]?.visible).toBe(false);
    expect(serializerProperties["question:showNumber"]?.visible).toBe(false);
    expect(serializerProperties["question:hideNumber"]?.visible).toBe(false);
    expect(serializerProperties["panel:showNumber"]?.visible).toBe(false);
    expect(serializerProperties["panel:showQuestionNumbers"]?.visible).toBe(false);
    expect(serializerProperties["paneldynamic:showNumber"]?.visible).toBe(false);
    expect(serializerProperties["paneldynamic:showQuestionNumbers"]?.visible).toBe(false);
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
        area: "logic-tab",
        survey: logicSurvey,
      });
    });

    expect(designerSurvey.applyTheme).not.toHaveBeenCalled();
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

  it("keeps SurveyJS builder overrides visual-only so Creator layout stays intact", () => {
    const appCss = readAppCss();

    expect(appCss).not.toContain("FINAL SurveyJS Builder override");
    expect(appCss).not.toMatch(/\nbutton\s*\{[^}]*box-shadow:/s);
    expect(appCss).not.toMatch(/\nbutton,\s*\n\.button-link\s*\{/s);
    expect(appCss).not.toMatch(/\nbutton:hover,\s*\n\.button-link:hover\s*\{/s);
    expect(appCss).not.toMatch(/\nbutton:focus-visible,\s*\n\.button-link:focus-visible/s);
    expect(appCss).not.toMatch(/\nbutton:disabled\s*\{/s);
    expect(appCss).not.toMatch(/\.builder-creator-shell\s+\.svc-page\s*\{/);
    expect(appCss).not.toMatch(/\.builder-creator-shell\s+\.svc-creator\s+\.sd-(body|page|panel)/);
    expect(appCss).not.toMatch(
      /\.builder-creator-shell\s+\.sd-question\s+\.sd-description,\s*\.builder-creator-shell\s+\.sd-question__description\s*\{[^}]*display:/s,
    );
    expect(appCss).not.toMatch(
      /\.builder-creator-shell\s+\.sd-question\s+\.sd-description,\s*\.builder-creator-shell\s+\.sd-question__description\s*\{[^}]*padding:/s,
    );
    expect(appCss).not.toMatch(/\.builder-creator-shell\s+\.sd-description,\s*\.builder-creator-shell\s+\.sd-page__title/s);

    expect(appCss).toContain(".builder-creator-shell .svc-creator {");
    expect(appCss).toContain("--sjs-primary-backcolor: #121212;");
    expect(appCss).toContain(".builder-creator-shell .svc-side-bar");
    expect(appCss).toContain(".builder-creator-shell .spg-button-group__item--selected");
    expect(appCss).toContain(".app-button,");
    expect(appCss).toContain(".builder-toolbar-icon-button {");
    expect(appCss).toContain(".builder-toolbar-icon-item {");
    expect(appCss).toContain(".builder-creator-shell .svc-tabbed-menu .sv-dots.sv-action--hidden");
    expect(appCss).toContain(".builder-creator-shell .svc-toolbar-wrapper .sv-action.sv-action--hidden");
    expect(appCss).toContain(".builder-creator-shell .svc-toolbar-wrapper .sv-action.builder-toolbar-action-item");
    expect(appCss).toContain(".builder-creator-shell .svc-tab-designer .sd-root-modern .sd-container-modern__title");
    expect(appCss).toContain("background-color: transparent !important;");
    expect(appCss).not.toContain("max-width: max-content !important;");
    expect(appCss).toContain("max-width: none !important;");
  });

  it("lets SurveyJS manage the builder top bar layout without custom flex overrides", () => {
    const appCss = readAppCss();

    expect(appCss).not.toMatch(/\.builder-creator-shell\s+\.svc-top-bar\s*\{/s);
    expect(appCss).not.toMatch(/\.builder-creator-shell\s+\.svc-top-bar\s+\.svc-tabbed-menu-wrapper\s*\{/s);
    expect(appCss).not.toMatch(/\.builder-creator-shell\s+\.svc-top-bar\s+\.svc-toolbar-wrapper\s*\{/s);
    expect(appCss).not.toMatch(/\.builder-creator-shell\s+\.svc-top-bar\s+\.sv-action-bar-item\s*\{/s);
  });

  it("imports the SurveyJS base theme so creator actions keep their intended layout", () => {
    const surveyBuilderSource = readSurveyBuilderSource();

    expect(surveyBuilderSource).toContain('import "survey-core/defaultV2.min.css";');
    expect(surveyBuilderSource).toContain('import "survey-creator-core/survey-creator-core.min.css";');
  });

  it("keeps the built-in save action icon-only while custom builder actions stay compact text buttons", () => {
    const surveyBuilderSource = readSurveyBuilderSource();

    expect(surveyBuilderSource).toContain('saveAction.css = "builder-toolbar-icon-item";');
    expect(surveyBuilderSource).toContain('builder-toolbar-icon-button');
    expect(surveyBuilderSource).toContain('resetAction.innerCss = "builder-toolbar-action-button";');
    expect(surveyBuilderSource).toContain('saveTemplateAction.innerCss = `builder-toolbar-action-button ${');
  });

  it("stretches the custom runtime preview tab before centering the form card", () => {
    const appCss = readAppCss();

    expect(appCss).toMatch(
      /\.builder-preview-tab-shell\s*\{[^}]*width:\s*100%;[^}]*min-width:\s*0;[^}]*display:\s*flex;[^}]*justify-content:\s*center;/s,
    );
    expect(appCss).toMatch(
      /\.builder-creator-shell\s+\.svc-creator-tab__content,\s*\.builder-creator-shell\s+\.svc-plugin-tab__content\s*\{[^}]*width:\s*100%;[^}]*min-width:\s*0;/s,
    );
    expect(appCss).toMatch(
      /\.builder-preview-tab-surface\.survey-page-card\s*\{[^}]*width:\s*min\(1060px,\s*100%\);[^}]*max-width:\s*1060px;[^}]*flex:\s*0 1 1060px;/s,
    );
  });

  it("keeps required stars attached to SurveyJS question titles in runtime and builder wrappers", () => {
    const appCss = readAppCss();

    expect(appCss).toMatch(
      /\.survey-page-card\s+\.sd-question__title,\s*\.builder-creator-shell\s+\.sd-question__title\s*\{[^}]*white-space:\s*normal[^}]*overflow-wrap:\s*break-word[^}]*word-break:\s*normal/s,
    );
    expect(appCss).toMatch(
      /\.survey-page-card\s+\.sd-question__required-text,\s*\.builder-creator-shell\s+\.sd-question__required-text\s*\{[^}]*white-space:\s*nowrap/s,
    );
  });

  it("keeps the builder editor full-width and syncs creator JSON into the runtime preview tab bridge", async () => {
    renderBuilder();

    await waitFor(() => {
      expect(creatorInstances).toHaveLength(1);
    });

    expect(screen.queryByTestId("builder-runtime-preview")).not.toBeInTheDocument();
    expect(screen.queryByTestId("survey-form-renderer")).not.toBeInTheDocument();
    expect(document.querySelector(".builder-workbench")).not.toBeInTheDocument();
    expect(document.querySelector(".builder-creator-shell")?.children).toHaveLength(1);

    act(() => {
      creatorInstances[0].JSON = {
        title: "Обновлённое превью",
        locale: "ru",
        pages: [{ name: "page1", elements: [{ type: "text", name: "q1", title: "Вопрос" }] }],
      };
      creatorInstances[0].onModified.fire(creatorInstances[0], { type: "PROPERTY_CHANGED" });
    });

    await waitFor(() => {
      const runtimePreviewPlugin = creatorInstances[0].plugins["runtime-preview"] as { activate: () => void };
      runtimePreviewPlugin.activate();
    });

    expect(getBuilderPreviewSnapshot()).toMatchObject({
      formId: undefined,
      previewSchema: {
        title: "Обновлённое превью",
        locale: "ru",
        showQuestionNumbers: false,
        pages: [
          {
            name: "page1",
            elements: [{ type: "text", name: "q1", title: "Вопрос", showNumber: false }],
          },
        ],
      },
    });
  });

  it("uses a two-column metadata grid with black save and soft red cancel actions in the post-save settings dialog", () => {
    const appCss = readAppCss();

    expect(appCss).toMatch(/\.deadline-modal-title\s*\{[^}]*text-align:\s*center;/);
    expect(appCss).toMatch(/\.deadline-modal-subtitle\s*\{[^}]*color:\s*#4f6f91;[^}]*font-weight:\s*700;/);
    expect(appCss).toMatch(/\.deadline-modal-primary-grid\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\);/);
    expect(appCss).toMatch(/\.deadline-modal \.deadline-save-button\s*\{[^}]*background:\s*linear-gradient\(180deg,\s*#27272a,\s*#111111\);[^}]*color:\s*#ffffff;/);
    expect(appCss).toMatch(/\.deadline-modal \.deadline-clear-button\s*\{[^}]*background:\s*rgba\(254,\s*226,\s*226,\s*0\.88\);[^}]*color:\s*#b91c1c;/);
    expect(appCss).toMatch(/\.deadline-modal \.deadline-clear-button:hover,\s*\.deadline-modal \.deadline-clear-button:focus-visible\s*\{[^}]*background:\s*rgba\(254,\s*202,\s*202,\s*0\.92\);[^}]*color:\s*#991b1b;/);
    expect(appCss.lastIndexOf(".deadline-modal .deadline-save-button")).toBeGreaterThan(
      appCss.indexOf(".deadline-clear-button,\n.deadline-save-button,\n.responses-export-button"),
    );
  });

  it("centers the reset confirmation title and uses a black cancel button", () => {
    const appCss = readAppCss();
    const surveyBuilderSource = readSurveyBuilderSource();

    expect(appCss).toMatch(/\.builder-reset-title\s*\{[^}]*text-align:\s*center;/);
    expect(surveyBuilderSource).toContain('className="deadline-action-cancel-button"');
    expect(appCss).toMatch(/\.deadline-action-cancel-button\s*\{[^}]*background:\s*linear-gradient\(180deg,\s*#27272a,\s*#111111\);[^}]*color:\s*#ffffff;/);
  });

  it("keeps toast notifications above modal backdrops", () => {
    const appCss = readAppCss();
    const toastZIndex = Number(appCss.match(/\.toast-container\s*\{[^}]*z-index:\s*(\d+);/)?.[1]);
    const modalZIndex = Number(appCss.match(/\.modal-backdrop\s*\{[^}]*z-index:\s*(\d+);/)?.[1]);

    expect(toastZIndex).toBeGreaterThan(modalZIndex);
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

  it("shows empty form metadata selects with visual placeholders instead of placeholder options", async () => {
    const appCss = readAppCss();

    expect(appCss).toMatch(/\.deadline-select-placeholder\s*\{[^}]*color:\s*var\(--text-muted\);[^}]*font-weight:\s*400;/);

    renderBuilder();

    await waitFor(() => {
      expect(creatorInstances).toHaveLength(1);
    });

    await act(async () => {
      await creatorInstances[0].saveSurveyFunc?.(1, vi.fn());
    });

    const settingsDialog = await screen.findByRole("dialog", { name: "Настройки формы" });
    const formTypeSelect = within(settingsDialog).getByLabelText("Тип формы");
    const formReasonSelect = within(settingsDialog).getByLabelText("Основание формы");
    const typePlaceholder = within(settingsDialog).getByText("Выберите тип");
    const reasonPlaceholder = within(settingsDialog).getByText("Выберите основание");

    expect(formTypeSelect).toHaveValue("");
    expect(formReasonSelect).toHaveValue("");
    expect(typePlaceholder.tagName).toBe("SPAN");
    expect(reasonPlaceholder.tagName).toBe("SPAN");
    expect(within(formTypeSelect).queryByRole("option", { name: "Выберите тип" })).not.toBeInTheDocument();
    expect(within(formReasonSelect).queryByRole("option", { name: "Выберите основание" })).not.toBeInTheDocument();
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

    expect(JSON.parse(localStorage.getItem(getSurveyBuilderDraftStorageKey("user-1")) ?? "{}")).toMatchObject({
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
    expect(JSON.parse(localStorage.getItem(getSurveyBuilderDraftStorageKey("user-1")) ?? "{}")).toMatchObject({
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
      expect(getFormById).toHaveBeenCalledWith("template-7", expect.objectContaining({ signal: expect.any(Object) }));
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
      expect.objectContaining({ themeName: "defaultV2" }),
      "Шаблон для правки",
    );
    expect(navigate).toHaveBeenCalledWith(routes.templates, { replace: true, state: { refreshList: true } });
  });

  it("does not hydrate the editor with a form owned by another non-admin user", async () => {
    getFormById.mockResolvedValue(
      createTemplateForm({
        id: "victim-form",
        title: "Приватная форма другого автора",
        author_id: "victim-user",
      } as never) as never,
    );

    renderBuilder("victim-form");

    await waitFor(() => {
      expect(showToast).toHaveBeenCalledWith("У вас нет прав на редактирование этой формы", "error");
    });
    expect(creatorInstances[0].JSON.title).not.toBe("Приватная форма другого автора");
  });

  it("normalizes old numbering flags before loading an existing form and before saving it", async () => {
    getFormById.mockResolvedValue(
      createTemplateForm({
        id: "template-9",
        title: "Старая форма",
        schema: {
          title: "Старая форма",
          locale: "ru",
          showQuestionNumbers: "on",
          pages: [
            {
              name: "page1",
              elements: [
                {
                  type: "text",
                  name: "q1",
                  title: "Вопрос",
                  showNumber: true,
                  hideNumber: true,
                },
                {
                  type: "paneldynamic",
                  name: "group1",
                  title: "Группа",
                  showNumber: true,
                  showQuestionNumbers: "onSurvey",
                  templateElements: [
                    {
                      type: "text",
                      name: "nested",
                      title: "Вложенный вопрос",
                      showNumber: true,
                    },
                  ],
                },
              ],
            },
          ],
        } as SurveySchema,
      }) as never,
    );

    renderBuilder("template-9");

    await waitFor(() => {
      expect(creatorInstances).toHaveLength(1);
      expect(getFormById).toHaveBeenCalledWith("template-9", expect.objectContaining({ signal: expect.any(Object) }));
    });

    await waitFor(() => {
      expect(creatorInstances[0].JSON).toMatchObject({
        title: "Старая форма",
        showQuestionNumbers: false,
        pages: [
          {
            name: "page1",
            elements: [
              {
                type: "text",
                name: "q1",
                showNumber: false,
              },
              {
                type: "paneldynamic",
                name: "group1",
                showNumber: false,
                showQuestionNumbers: "off",
                templateElements: [
                  {
                    type: "text",
                    name: "nested",
                    showNumber: false,
                  },
                ],
              },
            ],
          },
        ],
      });
    });

    const callback = vi.fn();

    await act(async () => {
      await creatorInstances[0].saveSurveyFunc?.(1, callback);
    });

    expect(callback).toHaveBeenCalledWith(1, true);
    expect(saveSurveySchema).toHaveBeenCalledWith(
      "template-9",
      expect.objectContaining({
        showQuestionNumbers: false,
        pages: [
          {
            name: "page1",
            elements: [
              expect.objectContaining({
                type: "text",
                name: "q1",
                showNumber: false,
              }),
              expect.objectContaining({
                type: "paneldynamic",
                name: "group1",
                showNumber: false,
                showQuestionNumbers: "off",
                templateElements: [
                  expect.objectContaining({
                    type: "text",
                    name: "nested",
                    showNumber: false,
                  }),
                ],
              }),
            ],
          },
        ],
      }),
      expect.objectContaining({ themeName: "defaultV2" }),
      "Старая форма",
    );

    const savedSchema = saveSurveySchema.mock.calls[0]?.[1] as SurveySchema;
    expect(((savedSchema.pages?.[0]?.elements?.[0] ?? {}) as { hideNumber?: boolean }).hideNumber).toBeUndefined();
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

    expect(localStorage.getItem(getSurveyBuilderDraftStorageKey("user-1"))).not.toBeNull();

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

    expect(localStorage.getItem(getSurveyBuilderDraftStorageKey("user-1"))).toBeNull();
    expect(navigate).toHaveBeenCalledWith(routes.templates, { replace: true, state: { refreshList: true } });
  });
});
