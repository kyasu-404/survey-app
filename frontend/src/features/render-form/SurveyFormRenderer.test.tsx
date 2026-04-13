import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SurveyFormRenderer } from "./SurveyFormRenderer";

const showToast = vi.fn();
const mutateAsync = vi.fn().mockRejectedValue(new Error("api failed"));
const createdModelSchemas: Array<Record<string, unknown>> = [];

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
  Model: class {
    locale = "ru";
    completeText = "";
    completedHtml = "";
    data: Record<string, unknown> = {};
    onCompleting = new FakeSurveyEvent();
    onUploadFiles = new FakeSurveyEvent();
    onClearFiles = new FakeSurveyEvent();
    doComplete = vi.fn();

    constructor(schema: Record<string, unknown>) {
      createdModelSchemas.push(schema);
    }
  },
}));

vi.mock("survey-react-ui", () => ({
  Survey: ({
    model,
  }: {
    model: { completeText: string; data: Record<string, unknown>; onCompleting: { fire: (arg: unknown, options: unknown) => Promise<void> } };
  }) => (
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
    showToast.mockClear();
    mutateAsync.mockClear();
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
});
