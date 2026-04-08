import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { routes } from "../../app/routes";
import SurveyPage from "./SurveyPage";

const { getPublicFormById } = vi.hoisted(() => ({
  getPublicFormById: vi.fn(),
}));

vi.mock("../../entities/survey/api/surveysApi", () => ({
  getPublicFormById,
}));

vi.mock("../../widgets/SurveyRenderer/SurveyRenderer", () => ({
  SurveyRenderer: () => <div>Survey renderer content</div>,
}));

describe("SurveyPage", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  function renderPage(initialEntry: string) {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    });

    render(
      <MemoryRouter initialEntries={[initialEntry]}>
        <QueryClientProvider client={queryClient}>
          <Routes>
            <Route path={routes.surveyById} element={<SurveyPage />} />
          </Routes>
        </QueryClientProvider>
      </MemoryRouter>,
    );
  }

  it("renders the public shell with the form title, subtitle, and renderer content", async () => {
    getPublicFormById.mockResolvedValueOnce({
      id: "form-1",
      title: "Анкета обратной связи",
      schema: { pages: [] },
    });

    renderPage(routes.survey("form-1"));

    expect(await screen.findByRole("heading", { name: "Анкета обратной связи" })).toBeInTheDocument();
    expect(screen.getByText("Публичная форма")).toBeInTheDocument();
    expect(screen.getByText("Заполните форму и отправьте ответ, когда будете готовы.")).toBeInTheDocument();
    expect(screen.getByText("Survey renderer content")).toBeInTheDocument();
  });

  it("uses a preview subtitle when the page is opened in preview mode", async () => {
    getPublicFormById.mockResolvedValueOnce({
      id: "form-1",
      title: "Анкета обратной связи",
      schema: { pages: [] },
    });

    renderPage(`${routes.survey("form-1")}?mode=preview`);

    expect(await screen.findByRole("heading", { name: "Анкета обратной связи" })).toBeInTheDocument();
    expect(screen.getByText("Режим предварительного просмотра. Отправка ответа отключена.")).toBeInTheDocument();
    expect(screen.getByText("Survey renderer content")).toBeInTheDocument();
  });
});
