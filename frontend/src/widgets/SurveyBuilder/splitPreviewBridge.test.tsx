import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createEmptySurveySchema } from "../../entities/survey/model/surveyModel";
import type { SurveySchema } from "../../entities/survey/types";
import {
  SplitPreviewTab,
  registerSplitPreviewTabComponent,
} from "./SplitPreviewTab";
import {
  getSplitPreviewSnapshot,
  subscribeSplitPreview,
  updateSplitPreviewBridge,
} from "./splitPreviewBridge";

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

vi.mock("survey-creator-react", () => ({
  SurveyCreatorComponent: ({ creator }: { creator: { id?: string } }) => (
    <div data-testid="split-preview-creator">{creator?.id ?? "creator"}</div>
  ),
}));

vi.mock("../../features/render-form/SurveyFormRenderer", () => ({
  SurveyFormRenderer: ({
    formId,
    isPreview,
    schema,
  }: {
    formId: string;
    isPreview: boolean;
    schema: SurveySchema;
  }) => (
    <div data-testid="split-preview-renderer">
      {formId}|{String(isPreview)}|{schema.pages.length}
    </div>
  ),
}));

function resetSplitPreviewBridge() {
  updateSplitPreviewBridge({
    splitCreator: null,
    previewSchema: createEmptySurveySchema(),
    formId: undefined,
  });
}

describe("splitPreview bridge", () => {
  beforeEach(() => {
    resetSplitPreviewBridge();
    isElementRegistered.mockReset().mockReturnValue(false);
    registerElement.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("notifies subscribers until they unsubscribe", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeSplitPreview(listener);

    updateSplitPreviewBridge({ formId: "form-1" });
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    updateSplitPreviewBridge({ formId: "form-2" });

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("merges partial updates into the current preview state", () => {
    const previewSchema: SurveySchema = {
      pages: [
        {
          name: "page-1",
          elements: [],
        },
      ],
    };
    const splitCreator = { id: "creator-1" } as never;

    updateSplitPreviewBridge({
      formId: "form-1",
      previewSchema,
    });
    updateSplitPreviewBridge({
      splitCreator,
    });

    expect(getSplitPreviewSnapshot()).toMatchObject({
      formId: "form-1",
      previewSchema,
      splitCreator,
    });
  });

  it("renders an empty designer state until the creator is available", () => {
    render(<SplitPreviewTab />);

    expect(screen.getByText("Редактор загружается")).toBeInTheDocument();
    expect(screen.getByTestId("split-preview-renderer")).toHaveTextContent("__builder_preview__|true|1");
  });

  it("updates the preview when bridge state changes", () => {
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

    render(<SplitPreviewTab />);

    act(() => {
      updateSplitPreviewBridge({
        formId: "form-9",
        previewSchema,
        splitCreator: { id: "creator-9" } as never,
      });
    });

    expect(screen.getByTestId("split-preview-creator")).toHaveTextContent("creator-9");
    expect(screen.getByTestId("split-preview-renderer")).toHaveTextContent("form-9|true|2");
  });

  it("registers the split preview tab only once", () => {
    isElementRegistered.mockReturnValueOnce(false).mockReturnValueOnce(true);

    registerSplitPreviewTabComponent();
    registerSplitPreviewTabComponent();

    expect(registerElement).toHaveBeenCalledTimes(1);
    expect(registerElement).toHaveBeenCalledWith("svc-tab-split-preview", expect.any(Function));
  });
});
