import { readFileSync } from "node:fs";
import { join } from "node:path";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { routes } from "../../app/routes";
import { ThemeCycleButton } from "../../shared/theme/ThemeCycleButton";
import { ThemeProvider } from "../../shared/theme/ThemeProvider";
import { SurveyBuilder } from "./SurveyBuilder";
import { getBuilderPreviewSnapshot } from "./builderPreviewBridge";
import { getSurveyBuilderDraftStorageKey } from "./builderDraft";
import type { SurveySchema } from "../../entities/survey/types";
import { SUPABASE_URL } from "../../shared/config/env";

const DEFAULT_SURVEY_LOGO_TOKEN = "__APP_DEFAULT_CARD_LOGO__";
const UPLOADED_BACKGROUND_PATH = "forms/11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222/33333333-3333-4333-8333-333333333333.png";
const UPLOADED_BACKGROUND_URL = `${SUPABASE_URL}/storage/v1/object/public/survey-assets/${UPLOADED_BACKGROUND_PATH}`;

const {
  componentCollectionAdd,
  componentCollectionGetByName,
  cloneForm,
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
  createSurveyAssetFormId,
  uploadSurveyBackground,
} = vi.hoisted(() => ({
  componentCollectionAdd: vi.fn(),
  componentCollectionGetByName: vi.fn(),
  cloneForm: vi.fn(),
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
  createSurveyAssetFormId: vi.fn(() => "11111111-1111-4111-8111-111111111111"),
  uploadSurveyBackground: vi.fn(),
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
  cloneForm,
  getFormById,
  getForms,
  saveSurveySchema,
  setFormDeadline,
  setFormResponseLimit,
}));

vi.mock("../../shared/api/themeAssets", () => ({
  SURVEY_BACKGROUND_ACCEPT: "image/jpeg,image/png,image/webp",
  createSurveyAssetFormId,
  listCommonSurveyBackgrounds: vi.fn().mockResolvedValue([]),
  listCustomSurveyBackgrounds: vi.fn().mockResolvedValue([]),
  removeSurveyBackground: vi.fn().mockResolvedValue(undefined),
  uploadSurveyBackground,
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
  registerCreatorTheme: vi.fn(),
  registerSurveyTheme: vi.fn(),
}));

vi.mock("survey-core/themes", () => ({
  default: {},
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
    applyCreatorTheme = vi.fn();
    pageTitleFontEditor = { readOnly: true };
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
    onCollectionItemAllowOperations = new FakeEvent();
    onPropertyGetReadOnly = new FakeEvent();
    onSurveyInstanceCreated = new FakeEvent();
    onModified = new FakeEvent();
    onActiveTabChanged = new FakeEvent();
    onUploadFile = new FakeEvent();
    onQuestionAdded = new FakeEvent();
    themeEditor = {
      onThemePropertyChanged: new FakeEvent(),
      onThemeSelected: new FakeEvent(),
      propertyGrid: {
        survey: {
          getQuestionByName: vi.fn((name: string) => name === "pageTitle" ? this.pageTitleFontEditor : undefined),
        },
      },
      themeModel: {
        setTheme: vi.fn(),
      },
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

function renderBuilder(formId?: string, safeEditingResponseCount = 0) {
  return render(
    <MemoryRouter>
      <QueryClientProvider client={createQueryClient()}>
        <SurveyBuilder
          formId={formId}
          userId="user-1"
          safeEditingResponseCount={safeEditingResponseCount}
        />
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
    allow_response_editing: false,
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
    cloneForm.mockResolvedValue({ id: "copy-form-id" });
    setFormDeadline.mockResolvedValue(undefined);
    setFormResponseLimit.mockResolvedValue(undefined);
    createSurveyMutateAsync.mockResolvedValue({ id: "created-form-id" });
    uploadSurveyBackground.mockResolvedValue({
      path: UPLOADED_BACKGROUND_PATH,
      url: UPLOADED_BACKGROUND_URL,
    });
    surveyFormRendererProps.length = 0;
    registerElement.mockClear();
  });

  it("applies the beige Survey Creator UI theme independently of the survey palette", async () => {
    renderBuilder();

    await waitFor(() => {
      expect(creatorInstances).toHaveLength(1);
      expect(creatorInstances[0].applyCreatorTheme).toHaveBeenCalledWith(
        expect.objectContaining({
          themeName: "survey-app-creator-sand",
          iconSet: "v2",
          isLight: true,
          cssVariables: expect.objectContaining({
            "--sjs-primary-backcolor": "#765137",
            "--sjs-general-backcolor": "#fffdfa",
            "--sjs-general-forecolor": "#332b24",
            "--sjs-special-background": "#f5efe7",
            "--sjs2-color-utility-surface-designer": "#eee7dd",
          }),
        }),
      );
    });
  });

  it("switches the Creator UI palette without recreating the builder", async () => {
    window.localStorage.setItem("survey-app:theme", "sky");
    const user = userEvent.setup();

    render(
      <ThemeProvider>
        <MemoryRouter>
          <QueryClientProvider client={createQueryClient()}>
            <SurveyBuilder userId="user-1" />
            <ThemeCycleButton />
          </QueryClientProvider>
        </MemoryRouter>
      </ThemeProvider>,
    );

    await waitFor(() => {
      expect(creatorInstances).toHaveLength(1);
      expect(creatorInstances[0].applyCreatorTheme).toHaveBeenLastCalledWith(
        expect.objectContaining({ themeName: "survey-app-creator-sky" }),
      );
    });

    await user.click(screen.getByRole("button", { name: /Сменить тему/i }));
    await user.click(screen.getByRole("menuitemradio", { name: "Зелёная" }));

    await waitFor(() => {
      expect(creatorInstances).toHaveLength(1);
      expect(creatorInstances[0].applyCreatorTheme).toHaveBeenLastCalledWith(
        expect.objectContaining({ themeName: "survey-app-creator-teal" }),
      );
    });
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

  it("applies a locally uploaded Theme Editor background immediately", async () => {
    renderBuilder();

    await waitFor(() => {
      expect(creatorInstances).toHaveLength(1);
    });

    const creator = creatorInstances[0];
    const callback = vi.fn();
    const file = new File(["image"], "background.png", { type: "image/png" });

    act(() => {
      creator.onUploadFile.fire(creator, {
        elementType: "theme",
        propertyName: "backgroundImage",
        files: [file],
        callback,
      });
    });

    await waitFor(() => {
      expect(callback).toHaveBeenCalledWith(
        "success",
        UPLOADED_BACKGROUND_URL,
      );
    });

    expect(creator.theme).toMatchObject({
      backgroundImage: UPLOADED_BACKGROUND_URL,
    });
    expect(creator.themeEditor.themeModel.setTheme).toHaveBeenCalledWith(
      expect.objectContaining({
        backgroundImage: UPLOADED_BACKGROUND_URL,
      }),
    );
    expect(getBuilderPreviewSnapshot().previewTheme).toMatchObject({
      backgroundImage: UPLOADED_BACKGROUND_URL,
    });
    expect(JSON.parse(
      localStorage.getItem(getSurveyBuilderDraftStorageKey("user-1")) ?? "{}",
    )).toMatchObject({
      theme: {
        backgroundImage: UPLOADED_BACKGROUND_URL,
      },
    });
  });

  it("keeps an uploaded custom logo in the draft and runtime preview schema", async () => {
    const assetPath = "forms/11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222/33333333-3333-4333-8333-333333333333.png";
    const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/survey-assets/${assetPath}`;
    uploadSurveyBackground.mockResolvedValueOnce({ path: assetPath, url: publicUrl });
    renderBuilder();

    await waitFor(() => {
      expect(creatorInstances).toHaveLength(1);
    });

    const creator = creatorInstances[0];
    const callback = vi.fn();
    const file = new File(["logo"], "logo.png", { type: "image/png" });

    act(() => {
      creator.onUploadFile.fire(creator, {
        elementType: "survey",
        propertyName: "logo",
        files: [file],
        callback,
      });
    });

    await waitFor(() => {
      expect(callback).toHaveBeenCalledWith("success", publicUrl);
    });

    act(() => {
      creator.JSON = { ...creator.JSON, logo: publicUrl };
      creator.onModified.fire(creator, { type: "PROPERTY_CHANGED", propertyName: "logo" });
    });

    const expectedToken = `__APP_SURVEY_ASSET__/${assetPath}`;
    await waitFor(() => {
      expect(getBuilderPreviewSnapshot().previewSchema.logo).toBe(expectedToken);
    });
    expect(JSON.parse(
      localStorage.getItem(getSurveyBuilderDraftStorageKey("user-1")) ?? "{}",
    )).toMatchObject({
      schema: { logo: expectedToken },
    });
  });

  it("keeps a custom gallery upload in the active Theme Editor model", async () => {
    const { container } = renderBuilder();

    await waitFor(() => {
      expect(creatorInstances).toHaveLength(1);
    });

    const creator = creatorInstances[0];
    const galleryAction = creator.toolbar.getActionById("builder-background-gallery");

    act(() => {
      galleryAction.action();
    });

    expect(await screen.findByRole("dialog", { name: "Галерея фонов" })).toBeInTheDocument();

    const fileInput = await waitFor(() => {
      const input = container.querySelector(".theme-background-file-input");
      expect(input).toBeInstanceOf(HTMLInputElement);
      return input as HTMLInputElement;
    });
    const file = new File(["image"], "my-background.png", { type: "image/png" });
    await userEvent.upload(fileInput, file);

    await waitFor(() => {
      expect(creator.themeEditor.themeModel.setTheme).toHaveBeenCalledWith(
        expect.objectContaining({
          backgroundImage: UPLOADED_BACKGROUND_URL,
          backgroundOpacity: 1,
        }),
      );
    });

    expect(creator.theme).toMatchObject({
      backgroundImage: UPLOADED_BACKGROUND_URL,
      backgroundOpacity: 1,
    });
    expect(getBuilderPreviewSnapshot().previewTheme).toMatchObject({
      backgroundImage: UPLOADED_BACKGROUND_URL,
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
        logoPosition: "left",
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
        logoPosition: "left",
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
      logoPosition: "left",
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

    const galleryAction = creator.toolbar.getActionById("builder-background-gallery");
    const resetAction = creator.toolbar.getActionById("builder-reset");
    const saveTemplateAction = creator.toolbar.getActionById("builder-save-template");

    expect(galleryAction).toMatchObject({ visible: false, innerCss: "builder-toolbar-action-button" });
    expect(resetAction).toMatchObject({ visible: true, innerCss: "builder-toolbar-action-button" });
    expect(saveTemplateAction).toMatchObject({ visible: true, innerCss: "builder-toolbar-action-button" });

    act(() => {
      creator.activeTab = "theme";
      creator.onActiveTabChanged.fire(creator, { tabName: "theme" });
    });

    expect(galleryAction.visible).toBe(true);
    expect(resetAction.visible).toBe(false);
    expect(saveTemplateAction.visible).toBe(false);
    expect(creator.pageTitleFontEditor.readOnly).toBe(false);

    act(() => {
      creator.activeTab = "designer";
      creator.onActiveTabChanged.fire(creator, { tabName: "designer" });
    });

    expect(galleryAction.visible).toBe(false);
    expect(resetAction.visible).toBe(true);
    expect(saveTemplateAction.visible).toBe(true);
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
      "organization",
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
    expect(componentCollectionAdd).toHaveBeenCalledTimes(8);
    expect(componentCollectionAdd).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "organization",
        questionJSON: expect.objectContaining({
          type: "dropdown",
          placeholder: "Начните вводить название…",
          choices: [],
        }),
        inheritBaseProps: true,
      }),
    );
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

    expect(designerSurvey.applyTheme).toHaveBeenCalledWith(
      expect.objectContaining({
        themeName: "default",
        colorPalette: "light",
      }),
    );
    expect(logicSurvey.applyTheme).not.toHaveBeenCalled();

    creator.theme = {
      themeName: "sharp",
      colorPalette: "dark",
      isPanelless: true,
      backgroundImage: "/theme-background.png",
      backgroundOpacity: 0.85,
      headerView: "advanced",
      header: { height: 260 },
      cssVariables: {
        "--sjs-font-family": "Georgia, serif",
        "--sjs-corner-radius": "20px",
      },
    };

    act(() => {
      creator.themeEditor.onThemePropertyChanged.fire(creator.themeEditor, {
        name: "--sjs-corner-radius",
        value: "20px",
      });
    });

    expect(designerSurvey.applyTheme).toHaveBeenLastCalledWith(
      expect.objectContaining({
        themeName: "sharp",
        colorPalette: "dark",
        isPanelless: true,
        backgroundImage: "/theme-background.png",
        backgroundOpacity: 0.18,
        headerView: "advanced",
        header: { height: 260 },
        cssVariables: expect.objectContaining({
          "--sjs-font-family": "Georgia, serif",
          "--sjs-corner-radius": "20px",
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

  it("protects existing questions and technical collection values in safe editing mode", async () => {
    getFormById.mockResolvedValue(createTemplateForm({
      id: "answered-form",
      title: "Форма с ответами",
      form_type: "survey",
      responses_count: 18,
      schema: {
        title: "Форма с ответами",
        pages: [{
          name: "page1",
          elements: [{
            type: "radiogroup",
            name: "status",
            title: "Статус",
            choices: [{ value: "yes", text: "Да" }],
          }],
        }],
      },
    } as never) as never);

    renderBuilder("answered-form", 18);

    await waitFor(() => {
      expect(creatorInstances[0]?.JSON).toMatchObject({ title: "Форма с ответами" });
    });

    const creator = creatorInstances[0];
    expect(creator.options.useElementTitles).toBe(true);
    expect(screen.getByRole("status")).toHaveTextContent(
      "У формы есть 18 ответов. Включён безопасный режим редактирования.",
    );

    const oldQuestionOperations = {
      element: { name: "status" },
      obj: { name: "status", getType: () => "radiogroup" },
      allowDelete: true,
      allowChangeType: true,
      allowChangeInputType: true,
      allowDrag: false,
      allowEdit: false,
    };
    creator.onElementAllowOperations.fire(creator, oldQuestionOperations);
    expect(oldQuestionOperations).toMatchObject({
      allowDelete: false,
      allowChangeType: false,
      allowChangeInputType: false,
      allowDrag: true,
      allowEdit: true,
    });

    const newQuestionOperations = {
      element: { name: "new-question" },
      obj: { name: "new-question", getType: () => "text" },
      allowDelete: true,
      allowChangeType: false,
      allowChangeInputType: true,
    };
    creator.onElementAllowOperations.fire(creator, newQuestionOperations);
    expect(newQuestionOperations.allowDelete).toBe(true);
    expect(newQuestionOperations.allowChangeType).toBe(true);

    const nameProperty = {
      element: { getType: () => "radiogroup" },
      property: { name: "name" },
      readOnly: false,
    };
    creator.onPropertyGetReadOnly.fire(creator, nameProperty);
    expect(nameProperty.readOnly).toBe(true);

    const oldChoiceOperations = {
      element: { name: "status" },
      propertyName: "choices",
      item: { value: "yes", text: "Да" },
      allowDelete: true,
    };
    creator.onCollectionItemAllowOperations.fire(creator, oldChoiceOperations);
    expect(oldChoiceOperations.allowDelete).toBe(false);

    const choiceValueProperty = {
      parentElement: { name: "status" },
      parentProperty: { name: "choices" },
      property: { name: "value" },
      element: { value: "yes", text: "Да" },
      readOnly: false,
    };
    creator.onPropertyGetReadOnly.fire(creator, choiceValueProperty);
    expect(choiceValueProperty.readOnly).toBe(true);

    const newQuestion = { isRequired: true, descriptionLocation: "", getType: () => "text" };
    creator.onQuestionAdded.fire(creator, { question: newQuestion });
    expect(newQuestion.isRequired).toBe(false);
    expect(creator.toolbar.getActionById("builder-reset")?.visible).toBe(false);
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
    expect(appCss).not.toMatch(/\.builder-creator-shell\s+\.sd-description,\s*\.builder-creator-shell\s+\.sd-page__title/s);

    expect(appCss).toContain(".builder-creator-shell .svc-creator {");
    expect(appCss).toContain("--sjs-primary-backcolor: var(--creator-accent) !important;");
    expect(appCss).toContain(".builder-creator-shell .svc-side-bar");
    expect(appCss).toContain(".builder-creator-shell .spg-button-group__item--selected");
    expect(appCss).toContain(".app-button,");
    expect(appCss).toContain(".builder-toolbar-icon-button {");
    expect(appCss).toContain(".builder-toolbar-icon-item {");
    expect(appCss).toContain(".builder-creator-shell .svc-tabbed-menu .sv-dots.sv-action--hidden");
    expect(appCss).toContain(".builder-creator-shell .svc-toolbar-wrapper .sv-action.sv-action--hidden");
    expect(appCss).toContain(".builder-creator-shell .svc-toolbar-wrapper .sv-action.builder-toolbar-action-item");
    expect(appCss).not.toContain(".builder-creator-shell .svc-tab-designer .sd-root-modern .sd-container-modern__title");
    expect(appCss).not.toContain(".builder-creator-shell .sd-header__text::after");
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

    expect(surveyBuilderSource).toContain('import "survey-core/survey-core.css";');
    expect(surveyBuilderSource).toContain('import "survey-creator-core/survey-creator-core.css";');
    expect(surveyBuilderSource).toContain('registerSurveyTheme(SurveyTheme);');
    expect(surveyBuilderSource).toContain('registerCreatorTheme(...Object.values(creatorThemes));');
  });

  it("keeps the built-in save action icon-only while custom builder actions stay compact text buttons", () => {
    const surveyBuilderSource = readSurveyBuilderSource();

    expect(surveyBuilderSource).toContain('saveAction.css = "builder-toolbar-icon-item";');
    expect(surveyBuilderSource).toContain('builder-toolbar-icon-button');
    expect(surveyBuilderSource).toContain('resetAction.innerCss = "builder-toolbar-action-button";');
    expect(surveyBuilderSource).toContain('saveTemplateAction.innerCss = `builder-toolbar-action-button ${');
  });

  it("keeps all custom text actions neutral white in every application theme", () => {
    const appCss = readAppCss();

    expect(appCss).toMatch(
      /\.builder-creator-shell\s+\.builder-toolbar-action-button,\s*\.builder-creator-shell\s+\.builder-toolbar-action-button\.builder-toolbar-action-button-secondary\s*\{[^}]*background:\s*#ffffff\s*!important;[^}]*color:\s*#202124\s*!important;/s,
    );
  });

  it("uses a themed workspace while keeping survey question cards visible", () => {
    const appCss = readAppCss();

    expect(appCss).toMatch(
      /\.builder-creator-shell svc-tab-designer,\s*\.builder-creator-shell \.svc-tab-designer\s*\{[^}]*background:\s*var\(--creator-workspace\)\s*!important;/s,
    );
    expect(appCss).toMatch(
      /\.builder-creator-shell \.svc-question__content\s*\{[^}]*border:\s*1px solid rgba\(24,\s*24,\s*24,\s*0\.18\);[^}]*box-shadow:\s*0 2px 8px rgba\(24,\s*24,\s*24,\s*0\.1\);/s,
    );
  });

  it("keeps the designer logo and title left-aligned", () => {
    const appCss = readAppCss();

    expect(appCss).toMatch(
      /\.builder-creator-shell \.svc-designer-header \.svc-surface-header\s*\{[^}]*flex-direction:\s*row\s*!important;[^}]*align-items:\s*center\s*!important;[^}]*justify-content:\s*flex-start\s*!important;/s,
    );
    expect(appCss).toMatch(
      /\.builder-creator-shell \.svc-designer-header \.sd-header__text\s*\{[^}]*align-items:\s*flex-start;[^}]*text-align:\s*left;/s,
    );
    expect(appCss).toMatch(
      /\.builder-creator-shell \.svc-designer-header \.svc-logo-image,\s*\.builder-creator-shell \.svc-designer-header \.svc-logo-image-container\s*\{[^}]*order:\s*-1;/s,
    );
    expect(appCss).toMatch(
      /\.builder-creator-shell \.svc-designer-header,\s*\.builder-creator-shell \.svc-designer-header \.svc-surface-header,\s*\.builder-creator-shell \.svc-designer-header \.sd-container-modern__title\s*\{[^}]*background:\s*var\(--creator-workspace\)\s*!important;/s,
    );
    expect(appCss).toMatch(
      /\.builder-creator-shell \.svc-tab-designer \.svc-designer-header\s*\{[^}]*border-bottom:\s*2px solid #111111;/s,
    );
  });

  it("uses the public runtime page spacing in the custom preview tab", () => {
    const appCss = readAppCss();

    expect(appCss).toMatch(
      /\.survey-page\.builder-preview-tab-shell\s*\{[^}]*width:\s*100%;[^}]*min-width:\s*0;[^}]*flex:\s*0 0 auto;[^}]*height:\s*auto;[^}]*min-height:\s*100%;[^}]*padding-bottom:\s*48px;[^}]*overflow:\s*visible;/s,
    );
    expect(appCss).toMatch(
      /\.builder-creator-shell \.svc-creator-tab:has\(> \.builder-preview-tab-shell\)\s*\{[^}]*overflow-y:\s*auto;[^}]*overflow-x:\s*hidden;[^}]*scroll-padding-bottom:\s*48px;/s,
    );
    expect(appCss).toMatch(
      /\.app-main-public,\s*\.builder-creator-shell \.svc-creator-tab:has\(> \.builder-preview-tab-shell\)\s*\{[^}]*background:\s*radial-gradient\(circle at 14% 4%, rgba\(255, 255, 255, 0\.8\), transparent 26%\),\s*linear-gradient\(180deg, #f7f2ea 0%, #ebe2d6 100%\);/s,
    );
    expect(appCss).toMatch(/\.builder-preview-tab-shell\s*\{[^}]*background:\s*transparent;/s);
    expect(appCss).toMatch(/\.builder-preview-tab-shell::before\s*\{[^}]*content:\s*none;/s);
    expect(appCss).toMatch(
      /\.builder-creator-shell\s+\.svc-creator-tab__content,\s*\.builder-creator-shell\s+\.svc-plugin-tab__content\s*\{[^}]*width:\s*100%;[^}]*min-width:\s*0;/s,
    );
    expect(appCss).not.toMatch(/\.survey-page\.builder-preview-tab-shell\s*\{[^}]*padding:\s*[^;}]+;/s);
    expect(appCss).not.toContain(".builder-preview-tab-surface.survey-page-card");
    expect(appCss).toMatch(
      /\.survey-runtime-surface\.survey-page-card\s*\{[^}]*padding:\s*0;[^}]*border:\s*1px\s+solid\s+rgba\(78,\s*57,\s*39,\s*0\.12\);[^}]*border-radius:\s*28px;[^}]*background:\s*transparent\s*!important;[^}]*box-shadow:\s*0\s+22px\s+48px/s,
    );
  });

  it("keeps required stars attached and gives question descriptions a compact shared highlight", () => {
    const appCss = readAppCss();

    expect(appCss).toMatch(
      /\.builder-creator-shell\s+\.sd-question__title\s*\{[^}]*white-space:\s*normal[^}]*overflow-wrap:\s*break-word[^}]*word-break:\s*normal/s,
    );
    expect(appCss).toMatch(
      /\.builder-creator-shell\s+\.sd-question__required-text\s*\{[^}]*white-space:\s*nowrap/s,
    );
    expect(appCss).not.toMatch(/\.survey-page-card\s+\.sd-question__title\s*\{[^}]*font-(?:size|weight):/s);
    expect(appCss).toMatch(
      /\.builder-creator-shell \.sd-question \.sd-description,\s*\.builder-creator-shell \.sd-question__description,\s*\.survey-runtime-surface\.survey-page-card \.sd-question \.sd-description,\s*\.survey-runtime-surface\.survey-page-card \.sd-question__description\s*\{[^}]*display:\s*inline-block;[^}]*width:\s*fit-content;[^}]*max-width:\s*100%;[^}]*padding:\s*2px 6px;[^}]*border:\s*1px solid rgba\(96, 165, 250, 0\.55\);[^}]*border-radius:\s*4px;[^}]*background:\s*rgba\(219, 234, 254, 0\.88\)\s*!important;/s,
    );
  });

  it("keeps edit-only settings in the builder flow instead of overlaying the canvas", () => {
    const appCss = readAppCss();

    expect(appCss).toMatch(
      /\.builder-status-stack\s*\{[^}]*position:\s*relative;[^}]*grid-template-columns:\s*repeat\(auto-fit, minmax\(min\(320px, 100%\), 1fr\)\);[^}]*flex:\s*0 0 auto;[^}]*width:\s*100%;[^}]*pointer-events:\s*auto;/s,
    );
    expect(appCss).toMatch(/\.builder-status-stack:empty\s*\{[^}]*display:\s*none;/s);
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
      creatorInstances[0].theme = {
        themeName: "sharp",
        colorPalette: "dark",
        isPanelless: true,
        backgroundImage: "/preview-background.png",
        backgroundOpacity: 0.82,
        headerView: "advanced",
        header: { height: 280 },
        cssVariables: { "--sjs-corner-radius": "24px" },
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
      previewTheme: {
        themeName: "sharp",
        colorPalette: "dark",
        isPanelless: true,
        backgroundImage: "/preview-background.png",
        backgroundOpacity: 0.82,
        headerView: "advanced",
        header: { height: 280 },
        cssVariables: { "--sjs-corner-radius": "24px" },
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
    expect(appCss).toMatch(
      /\.builder-organization-settings-modal legend\s*\{[^}]*float:\s*left;[^}]*width:\s*100%;[^}]*overflow-wrap:\s*anywhere;/s,
    );
    expect(appCss).toMatch(
      /\.builder-organization-settings-modal \.builder-organization-options\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\);/s,
    );
  });

  it("centers the reset confirmation title and uses a black cancel button", () => {
    const appCss = readAppCss();
    const surveyBuilderSource = readSurveyBuilderSource();

    expect(appCss).toMatch(/\.builder-reset-title\s*\{[^}]*text-align:\s*center;/);
    expect(surveyBuilderSource).toContain('className="deadline-action-cancel-button"');
    expect(appCss).toMatch(/\.deadline-action-cancel-button\s*\{[^}]*background:\s*linear-gradient\(180deg,\s*#27272a,\s*#111111\);[^}]*color:\s*#ffffff;/);
  });

  it("keeps safe edit dark and softly darkens the compatibility action on hover", () => {
    const appCss = readAppCss();

    expect(appCss).toMatch(
      /\.builder-answered-warning \.deadline-save-button:hover,[^{]*\.builder-answered-warning \.deadline-save-button:focus-visible\s*\{[^}]*background:\s*linear-gradient\(180deg,\s*#3f3f46,\s*#18181b\);[^}]*color:\s*#ffffff;/s,
    );
    expect(appCss).toMatch(
      /\.builder-compatibility-modal \.deadline-save-button:hover,[^{]*\.builder-compatibility-modal \.deadline-save-button:focus-visible\s*\{[^}]*background:\s*linear-gradient\(180deg,\s*rgba\(248,\s*246,\s*243,\s*0\.98\),\s*rgba\(225,\s*220,\s*214,\s*0\.96\)\);[^}]*color:\s*#141414;/s,
    );
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
      expect.objectContaining({ themeName: "default" }),
      "Шаблон для правки",
      false,
      ["school", "kindergarten"],
    );
    expect(navigate).toHaveBeenCalledWith(routes.templates, { replace: true, state: { refreshList: true } });
  });

  it("does not render persistent form settings over the editor and preserves their saved values", async () => {
    getFormById.mockResolvedValue(
      createTemplateForm({
        id: "form-7",
        title: "Форма для правки",
        form_type: "survey",
        allow_response_editing: true,
        organization_types: ["school", "odo"],
        schema: {
          title: "Форма для правки",
          locale: "ru",
          pages: [{
            name: "page1",
            elements: [{ type: "organization", name: "organization", title: "Организация" }],
          }],
        },
      } as never) as never,
    );

    renderBuilder("form-7");

    await waitFor(() => {
      expect(creatorInstances[0]?.JSON).toMatchObject({ title: "Форма для правки" });
    });

    expect(screen.queryByText("Респондент сможет изменить свой ответ в этом браузере.")).not.toBeInTheDocument();
    expect(screen.queryByText("Организации для выбора:")).not.toBeInTheDocument();

    await act(async () => {
      await creatorInstances[0].saveSurveyFunc?.(1, vi.fn());
    });

    expect(saveSurveySchema).toHaveBeenCalledWith(
      "form-7",
      expect.objectContaining({ title: "Форма для правки" }),
      expect.any(Object),
      "Форма для правки",
      true,
      ["school", "odo"],
    );
  });

  it("asks for confirmation before saving warning-level changes to an answered form", async () => {
    getFormById.mockResolvedValue(createTemplateForm({
      id: "answered-form",
      title: "Форма с ответами",
      form_type: "survey",
      responses_count: 5,
    } as never) as never);
    saveSurveySchema
      .mockResolvedValueOnce({
        status: "confirmation_required",
        safeChanges: [],
        warnings: ["Добавлен новый необязательный вопрос «Адрес сайта»"],
        breakingChanges: [],
      })
      .mockResolvedValueOnce({
        status: "updated",
        safeChanges: [],
        warnings: ["Добавлен новый необязательный вопрос «Адрес сайта»"],
        breakingChanges: [],
      });

    renderBuilder("answered-form", 5);
    await waitFor(() => expect(creatorInstances[0]?.JSON).toMatchObject({ title: "Форма с ответами" }));
    creatorInstances[0].JSON.pages[0].elements.push({
      type: "text",
      name: "website",
      title: "Адрес сайта",
    });
    const callback = vi.fn();

    await act(async () => {
      await creatorInstances[0].saveSurveyFunc?.(1, callback);
    });

    const dialog = await screen.findByRole("dialog", { name: "Предупреждение об изменениях формы" });
    expect(dialog).toHaveTextContent("Добавлен новый необязательный вопрос «Адрес сайта»");
    expect(callback).not.toHaveBeenCalled();

    await userEvent.click(within(dialog).getByRole("button", { name: "Сохранить изменения" }));

    await waitFor(() => expect(saveSurveySchema).toHaveBeenCalledTimes(2));
    expect(saveSurveySchema.mock.calls[1]).toEqual([
      "answered-form",
      expect.objectContaining({ title: "Форма с ответами" }),
      expect.any(Object),
      "Форма с ответами",
      false,
      ["school", "kindergarten"],
      true,
    ]);
    expect(callback).toHaveBeenCalledWith(1, true);
    expect(navigate).toHaveBeenCalledWith(routes.dashboardMy, {
      replace: true,
      state: { refreshList: true },
    });
  });

  it("blocks incompatible changes and can copy the modified schema", async () => {
    getFormById.mockResolvedValue(createTemplateForm({
      id: "answered-form",
      title: "Форма с ответами",
      form_type: "survey",
      responses_count: 3,
    } as never) as never);
    saveSurveySchema.mockResolvedValueOnce({
      status: "blocked",
      safeChanges: [],
      warnings: [],
      breakingChanges: ["Изменён тип вопроса «Вопрос»"],
    });

    renderBuilder("answered-form", 3);
    await waitFor(() => expect(creatorInstances[0]?.JSON).toMatchObject({ title: "Форма с ответами" }));
    creatorInstances[0].JSON.pages[0].elements[0].type = "comment";
    const callback = vi.fn();

    await act(async () => {
      await creatorInstances[0].saveSurveyFunc?.(1, callback);
    });

    const dialog = await screen.findByRole("dialog", { name: "Несовместимые изменения формы" });
    expect(dialog).toHaveTextContent("Изменён тип вопроса «Вопрос»");
    expect(callback).toHaveBeenCalledWith(1, false);

    await userEvent.click(within(dialog).getByRole("button", { name: "Создать копию" }));

    await waitFor(() => expect(cloneForm).toHaveBeenCalled());
    expect(cloneForm).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "answered-form",
        schema: expect.objectContaining({
          pages: [expect.objectContaining({
            elements: [expect.objectContaining({ type: "comment", name: "q1" })],
          })],
        }),
      }),
      "user-1",
    );
    expect(navigate).toHaveBeenCalledWith(routes.builderEdit("copy-form-id"), { replace: true });
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
      expect.objectContaining({ themeName: "default" }),
      "Старая форма",
      false,
      ["school", "kindergarten"],
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
