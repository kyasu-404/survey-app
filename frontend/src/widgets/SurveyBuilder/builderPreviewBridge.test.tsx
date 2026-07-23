import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createEmptySurveySchema } from "../../entities/survey/model/surveyModel";
import { DEFAULT_SURVEY_THEME } from "../../entities/survey/model/surveyTheme";
import type { SurveySchema } from "../../entities/survey/types";
import type { ITheme } from "survey-core";
import {
  BUILDER_PREVIEW_COMPONENT_NAME,
  BuilderPreviewTab,
  registerBuilderPreviewTabComponent,
} from "./BuilderPreviewTab";
import {
  getBuilderPreviewSnapshot,
  subscribeBuilderPreview,
  updateBuilderPreviewBridge,
} from "./builderPreviewBridge";

const { isElementRegistered, registerElement } = vi.hoisted(() => ({
  isElementRegistered: vi.fn(() => false),
  registerElement: vi.fn(),
}));

vi.mock("survey-react-ui", () => ({
  ReactElementFactory: {
    Instance: {
      isElementRegistered,
      registerElement,
    },
  },
}));

vi.mock("../../features/render-form/SurveyFormRenderer", () => ({
  SurveyFormRenderer: ({
    formId,
    renderMode,
    schema,
    theme,
  }: {
    formId: string;
    renderMode?: string;
    schema: SurveySchema;
    theme?: ITheme;
  }) => (
    <div data-testid="builder-preview-renderer">
      {formId}|{renderMode}|{schema.pages.length}|{theme?.themeName}
    </div>
  ),
}));

function resetBuilderPreviewBridge() {
  updateBuilderPreviewBridge({
    previewSchema: createEmptySurveySchema(),
    previewTheme: DEFAULT_SURVEY_THEME,
    formId: undefined,
  });
}

describe("builder preview bridge", () => {
  beforeEach(() => {
    resetBuilderPreviewBridge();
    isElementRegistered.mockReset().mockReturnValue(false);
    registerElement.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("notifies subscribers until they unsubscribe", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeBuilderPreview(listener);

    updateBuilderPreviewBridge({ formId: "form-1" });
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    updateBuilderPreviewBridge({ formId: "form-2" });

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("merges only runtime preview data into the current preview state", () => {
    const previewSchema: SurveySchema = {
      pages: [
        {
          name: "page-1",
          elements: [],
        },
      ],
    };

    updateBuilderPreviewBridge({
      formId: "form-1",
      previewSchema,
    });

    expect(getBuilderPreviewSnapshot()).toEqual({
      formId: "form-1",
      previewSchema,
      previewTheme: DEFAULT_SURVEY_THEME,
    });
    expect(getBuilderPreviewSnapshot()).not.toHaveProperty("splitCreator");
  });

  it("renders only the runtime preview surface", () => {
    render(<BuilderPreviewTab />);

    const previewTab = screen.getByTestId("builder-preview-tab");
    const previewSurface = screen.getByTestId("builder-preview-renderer").closest(".survey-runtime-surface");

    expect(previewTab).toHaveClass("builder-preview-tab-shell", "survey-page", "survey-page-shell");
    expect(previewSurface).toHaveClass("survey-page-card", "card", "builder-preview-tab-surface");
    expect(screen.getByTestId("builder-preview-renderer")).toHaveTextContent(
      "__builder_preview__|readonly-navigable|1|defaultV2",
    );
    expect(screen.queryByLabelText("Редактор формы")).not.toBeInTheDocument();
    expect(screen.queryByText("Редактор загружается")).not.toBeInTheDocument();
  });

  it("updates the runtime preview when bridge state changes", () => {
    const previewSchema: SurveySchema = {
      pages: [
        {
          name: "page-1",
          elements: [],
        },
        {
          name: "page-2",
          elements: [],
        },
      ],
    };

    render(<BuilderPreviewTab />);

    act(() => {
      updateBuilderPreviewBridge({
        formId: "form-9",
        previewSchema,
      });
    });

    expect(screen.getByTestId("builder-preview-renderer")).toHaveTextContent(
      "form-9|readonly-navigable|2|defaultV2",
    );
  });

  it("registers the runtime preview tab only once", () => {
    isElementRegistered.mockReturnValueOnce(false).mockReturnValueOnce(true);

    registerBuilderPreviewTabComponent();
    registerBuilderPreviewTabComponent();

    expect(registerElement).toHaveBeenCalledTimes(1);
    expect(registerElement).toHaveBeenCalledWith(BUILDER_PREVIEW_COMPONENT_NAME, expect.any(Function));
  });
});
