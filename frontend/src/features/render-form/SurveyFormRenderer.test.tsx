import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SurveyFormRenderer } from "./SurveyFormRenderer";

const showToast = vi.fn();
const mutateAsync = vi.fn().mockRejectedValue(new Error("api failed"));

vi.mock("survey-react-ui", () => ({
  Survey: ({ model }: { model: { data: Record<string, unknown>; onComplete: { fire: (arg: unknown) => void } } }) => (
    <button
      onClick={() => {
        model.data = { email: "a@b.com" };
        model.onComplete.fire(model);
      }}
    >
      Complete survey
    </button>
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
  it("shows error toast when API submission fails", async () => {
    render(<SurveyFormRenderer formId="form-1" schema={{ pages: [] }} />);

    await userEvent.click(screen.getByRole("button", { name: "Complete survey" }));

    await waitFor(() => {
      expect(showToast).toHaveBeenCalledWith(expect.any(String), "error");
    });
  });
});
