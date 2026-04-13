import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SurveyFormRenderer } from "./SurveyFormRenderer";

const {
  componentCollectionAdd,
  componentCollectionGetByName,
  createdModelSchemas,
  mutateAsync,
  registeredCustomQuestionTypes,
  showToast,
} = vi.hoisted(() => {
  const registeredCustomQuestionTypes = new Set<string>();
  const componentCollectionAdd = vi.fn((definition: { name: string }) => {
    registeredCustomQuestionTypes.add(definition.name);
  });
  const componentCollectionGetByName = vi.fn((name: string) =>
    registeredCustomQuestionTypes.has(name) ? { name } : undefined,
  );

  return {
    componentCollectionAdd,
    componentCollectionGetByName,
    createdModelSchemas: [] as Array<Record<string, unknown>>,
    mutateAsync: vi.fn().mockRejectedValue(new Error("api failed")),
    registeredCustomQuestionTypes,
    showToast: vi.fn(),
  };
});

class FakeSurveyEvent<T = unknown> {
  private handlers: Array<(sender: T, options: unknown) => void | Promise<void>> = [];

  add(handler: (sender: T, options: unknown) => void | Promise<void>) {
    this.handlers.push(handler);
  }

  remove(handler: (sender: T, options: unknown) => void | Promise<void>) {
    this.handlers = this.handlers.filter((item) => item !== handler);
  }

  async fire(sender: T, options?: unknown) {
    await Promise.all(this.handlers.map((handler) => handler(sender, options)));
  }
}

vi.mock("survey-core", () => ({
  ComponentCollection: {
    Instance: {
      add: componentCollectionAdd,
      getCustomQuestionByName: componentCollectionGetByName,
    },
  },
  Model: class {
    locale = "ru";
    completeText = "";
    completedHtml = "";
    data: Record<string, unknown> = {};
    questionNames: string[] = [];
    onCompleting = new FakeSurveyEvent();
    onUploadFiles = new FakeSurveyEvent();
    onClearFiles = new FakeSurveyEvent();
    doComplete = vi.fn();

    constructor(schema: Record<string, unknown> & { pages?: Array<{ elements?: Array<{ type: string; name: string }> }> }) {
      createdModelSchemas.push(schema);
      const builtInQuestionTypes = new Set(["text", "comment", "radiogroup", "checkbox", "dropdown"]);
      this.questionNames =
        schema.pages?.flatMap((page) =>
          (page.elements ?? [])
            .filter((question) => builtInQuestionTypes.has(question.type) || registeredCustomQuestionTypes.has(question.type))
            .map((question) => question.name),
        ) ?? [];
    }
  },
}));

vi.mock("survey-react-ui", () => ({
  Survey: ({
    model,
  }: {
    model: {
      completeText: string;
      data: Record<string, unknown>;
      questionNames: string[];
      onCompleting: { fire: (arg: unknown, options: unknown) => Promise<void> };
    };
  }) => (
    <div>
      <div data-testid="survey-question-names">{model.questionNames.join(",")}</div>
      <div className="sd-body__navigation">
        <button
          className="sd-btn sd-btn--action"
          onClick={async () => {
            model.data = { email: "a@b.com" };
            await model.onCompleting.fire(model, { allowComplete: true, allow: true });
          }}
        >
          {model.completeText || "Отправить"}
        </button>
      </div>
    </div>
  ),
}));

vi.mock("../submit-response/useSubmitResponse", () => ({
  useSubmitResponseMutation: () => ({
    mutateAsync,
  }),
}));

vi.mock("../../app/providers/ToastProvider", () => ({
  useToast: () => ({
    showToast,
  }),
}));

describe("SurveyFormRenderer", () => {
  beforeEach(() => {
    createdModelSchemas.length = 0;
    registeredCustomQuestionTypes.clear();
    showToast.mockClear();
    mutateAsync.mockClear();
    componentCollectionAdd.mockClear();
    componentCollectionGetByName.mockClear();
    mutateAsync.mockRejectedValue(new Error("api failed"));
  });

  it("shows error toast when API submission fails", async () => {
    render(<SurveyFormRenderer formId="form-1" schema={{ pages: [] }} />);

    await userEvent.click(screen.getByRole("button", { name: "Отправить" }));

    await waitFor(() => {
      expect(showToast).toHaveBeenCalledWith(expect.any(String), "error");
    });
  });

  it("adds a submitting hook while the response is being sent", async () => {
    let resolveMutation!: () => void;
    mutateAsync.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveMutation = resolve;
        }),
    );

    const { container } = render(<SurveyFormRenderer formId="form-1" schema={{ pages: [] }} />);

    await userEvent.click(screen.getByRole("button", { name: "Отправить" }));

    await waitFor(() => {
      expect(container.querySelector(".survey-renderer-submitting")).toBeInTheDocument();
    });

    resolveMutation();

    await waitFor(() => {
      expect(container.querySelector(".survey-renderer-submitting")).not.toBeInTheDocument();
    });
  });

  it("does not pass the shared default logo token into the SurveyJS model", () => {
    render(
      <SurveyFormRenderer
        formId="form-1"
        schema={{
          logo: "__APP_DEFAULT_CARD_LOGO__",
          logoWidth: "120px",
          logoHeight: "90px",
          logoFit: "contain",
          pages: [],
        }}
      />,
    );

    expect(createdModelSchemas[0]?.logo).not.toBe("__APP_DEFAULT_CARD_LOGO__");
  });

  it("registers custom SurveyJS question types before creating the public model", () => {
    render(
      <SurveyFormRenderer
        formId="form-1"
        schema={{
          pages: [
            {
              name: "page1",
              elements: [
                { type: "text", name: "school", title: "Школа" },
                { type: "phone", name: "phone", title: "Телефон" },
                { type: "email", name: "email", title: "Email" },
              ],
            },
          ],
        }}
      />,
    );

    expect(componentCollectionAdd).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "phone",
        questionJSON: expect.objectContaining({
          type: "text",
          inputType: "tel",
        }),
      }),
    );
    expect(componentCollectionAdd).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "email",
        questionJSON: expect.objectContaining({
          type: "text",
          inputType: "email",
        }),
      }),
    );
    expect(screen.getByTestId("survey-question-names")).toHaveTextContent("school,phone,email");
  });
});
