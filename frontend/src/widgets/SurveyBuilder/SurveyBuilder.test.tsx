import { readFileSync } from "node:fs";
import { join } from "node:path";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SurveyBuilder } from "./SurveyBuilder";
import { getSurveyBuilderDraftStorageKey } from "./builderDraft";
import type { SurveySchema } from "../../entities/survey/types";

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
      pages: [{ name: "page1", title: "Страница 1", elements: [] }],
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
        pages: [{ name: "page1", title: "Страница 1", elements: [] }],
      });
    });

    expect(JSON.parse(localStorage.getItem(getSurveyBuilderDraftStorageKey()) ?? "{}")).toMatchObject({
      schema: expect.objectContaining({
        title: "Новая форма",
        pages: [{ name: "page1", title: "Страница 1", elements: [] }],
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
    expect(screen.queryByRole("button", { name: "Сбросить конструктор" })).not.toBeInTheDocument();
    expect(creator.toolbar.actions.map((action: { id: string }) => action.id)).toEqual([
      "builder-reset",
      "builder-save-template",
      "builder-create-template",
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
  });
});
