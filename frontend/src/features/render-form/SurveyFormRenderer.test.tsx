import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SurveyFormRenderer } from "./SurveyFormRenderer";

const showToast = vi.fn();
const mutateAsync = vi.fn().mockRejectedValue(new Error("api failed"));

vi.mock("survey-react-ui", () => ({
  Survey: ({ model }: { model: { completeText?: string; data: Record<string, unknown>; onComplete: { fire: (arg: unknown) => void } } }) => (
    <>
      {model.completeText ? (
        <button
          onClick={() => {
            model.data = { email: "a@b.com" };
            model.onComplete.fire(model);
          }}
        >
          {model.completeText}
        </button>
      ) : null}
      <button
        onClick={() => {
          model.data = { email: "a@b.com" };
          model.onComplete.fire(model);
        }}
      >
        Trigger complete
      </button>
    </>
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
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("shows scoped inline feedback and error toast when API submission fails", async () => {
    render(<SurveyFormRenderer formId="form-1" schema={{ pages: [] }} />);

    await userEvent.click(screen.getByRole("button", { name: "Trigger complete" }));

    expect(
      await screen.findByText(
        "Ошибка отправки: Не удалось отправить ответ. Проверьте подключение к интернету и попробуйте ещё раз.",
      ),
    ).toHaveClass(
      "survey-inline-feedback",
      "survey-inline-feedback-error",
    );

    await waitFor(() => {
      expect(showToast).toHaveBeenCalledWith(expect.any(String), "error");
    });
  });

  it("hides the complete action in preview mode", () => {
    render(<SurveyFormRenderer formId="form-1" schema={{ pages: [] }} isPreviewMode />);

    expect(screen.queryByRole("button", { name: "Завершить" })).not.toBeInTheDocument();
  });
});
