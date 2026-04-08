import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import BuilderPage from "./BuilderPage";

vi.mock("../../widgets/SurveyBuilder/SurveyBuilder", () => ({
  SurveyBuilder: ({ formId }: { formId?: string }) => <div data-testid="builder-host">builder host {formId}</div>,
}));

describe("BuilderPage", () => {
  it("renders the intro shell above the builder host", () => {
    render(
      <MemoryRouter initialEntries={["/builder/form-123"]}>
        <Routes>
          <Route path="/builder/:id" element={<BuilderPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByRole("heading", { name: "Редактирование формы" })).toBeInTheDocument();
    expect(
      screen.getByText("Соберите структуру, проверьте preview и публикуйте форму после проверки."),
    ).toBeInTheDocument();
    expect(screen.getByTestId("builder-host")).toBeInTheDocument();
  });
});
