import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SurveyBuilder } from "./SurveyBuilder";
import { getSurveyBuilderDraftStorageKey } from "./builderDraft";
import type { SurveySchema } from "../../entities/survey/types";

const {
  createSurveyMutateAsync,
  creatorInstances,
  getFormById,
  getForms,
  navigate,
  saveSurveySchema,
  showToast,
} = vi.hoisted(() => ({
  createSurveyMutateAsync: vi.fn(),
  creatorInstances: [] as any[],
  getFormById: vi.fn(),
  getForms: vi.fn(),
  navigate: vi.fn(),
  saveSurveySchema: vi.fn(),
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

    constructor() {
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

describe("SurveyBuilder", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    creatorInstances.length = 0;
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

  it("configures creator with collapsed sidebar, toolbar reset action, and flat text type list", async () => {
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

    expect(
      creator.toolbox.items.map((item: { name: string }) => item.name),
    ).toEqual([
      "text",
      "comment",
      "radiogroup",
      "checkbox",
      "dropdown",
      "text_number",
      "text_integer",
      "text_date",
      "text_time",
      "text_datetime-local",
      "text_phone",
      "text_email",
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
    ]);
    expect(creator.toolbox.items[0].items.map((item: { name: string }) => item.name)).toEqual([
      "text_plain",
      "text_number",
      "text_integer",
      "text_date",
      "text_time",
      "text_datetime-local",
      "text_phone",
      "text_email",
    ]);
    expect(creator.toolbox.items[5].showInToolboxOnly).toBe(true);

    const textOptions = {
      obj: {
        getType: () => "text",
      },
      allowChangeType: false,
      allowChangeInputType: true,
    };

    creator.onElementAllowOperations.fire(creator, textOptions);

    expect(textOptions.allowChangeType).toBe(true);
    expect(textOptions.allowChangeInputType).toBe(true);

    const ratingOptions = {
      obj: {
        getType: () => "rating",
      },
      allowChangeInputType: false,
    };

    creator.onElementAllowOperations.fire(creator, ratingOptions);

    expect(ratingOptions.allowChangeInputType).toBe(false);

    const previewSurvey = {
      applyTheme: vi.fn(),
    };

    act(() => {
      creator.onSurveyInstanceCreated.fire(creator, {
        area: "preview-tab",
        survey: previewSurvey,
      });
    });

    expect(previewSurvey.applyTheme).toHaveBeenCalledWith(
      expect.objectContaining({
        themeName: "defaultV2",
        cssVariables: expect.objectContaining({
          "--sjs-primary-backcolor": "#121212",
          "--sjs-primary-backcolor-dark": "#000000",
        }),
      }),
    );
  });
});
