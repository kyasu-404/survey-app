import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import SurveyPage from "./SurveyPage";

const { getFormById, getPublicFormById } = vi.hoisted(() => ({
  getFormById: vi.fn(),
  getPublicFormById: vi.fn(),
}));

vi.mock("../../app/providers/AuthProvider", () => ({
  useAuth: () => ({
    user: null,
    loading: false,
  }),
}));

vi.mock("../../entities/survey/api/surveysApi", () => ({
  getFormById,
  getPublicFormById,
}));

vi.mock("../../widgets/SurveyRenderer/SurveyRenderer", () => ({
  SurveyRenderer: () => <div data-testid="survey-renderer" />,
}));

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });
}

describe("SurveyPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders public survey shell hooks", async () => {
    getPublicFormById.mockResolvedValue({
      id: "form-1",
      title: "Анкета",
      is_public: true,
      schema: { pages: [] },
    });

    const { container } = render(
      <MemoryRouter initialEntries={["/form/form-1"]}>
        <QueryClientProvider client={createQueryClient()}>
          <Routes>
            <Route path="/form/:id" element={<SurveyPage />} />
          </Routes>
        </QueryClientProvider>
      </MemoryRouter>,
    );

    expect(await screen.findByTestId("survey-renderer")).toBeInTheDocument();
    expect(container.querySelector(".survey-page")).toBeInTheDocument();
    expect(container.querySelector(".survey-page-card")).toBeInTheDocument();
    expect(container.querySelector(".survey-page-shell")).toBeInTheDocument();
  });

  it("renders a loading skeleton while the survey is loading", async () => {
    let resolveForm!: (value: {
      id: string;
      title: string;
      is_public: boolean;
      schema: { pages: never[] };
    }) => void;

    getPublicFormById.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveForm = resolve;
        }),
    );

    const { container } = render(
      <MemoryRouter initialEntries={["/form/form-1"]}>
        <QueryClientProvider client={createQueryClient()}>
          <Routes>
            <Route path="/form/:id" element={<SurveyPage />} />
          </Routes>
        </QueryClientProvider>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(container.querySelector(".survey-page-skeleton")).toBeInTheDocument();
    });

    resolveForm({
      id: "form-1",
      title: "Анкета",
      is_public: true,
      schema: { pages: [] },
    });

    expect(await screen.findByTestId("survey-renderer")).toBeInTheDocument();
  });

  it("renders 404 page for a missing form", async () => {
    getPublicFormById.mockResolvedValue(null);

    render(
      <MemoryRouter initialEntries={["/form/missing"]}>
        <QueryClientProvider client={createQueryClient()}>
          <Routes>
            <Route path="/form/:id" element={<SurveyPage />} />
          </Routes>
        </QueryClientProvider>
      </MemoryRouter>,
    );

    expect(await screen.findByRole("heading", { name: "404" })).toBeInTheDocument();
    expect(screen.getByText("Форма не найдена или недоступна.")).toBeInTheDocument();
  });

  it("renders 404 page for a closed form", async () => {
    getPublicFormById.mockResolvedValue({
      id: "form-closed",
      title: "Закрытая форма",
      is_public: false,
      schema: { pages: [] },
    });

    render(
      <MemoryRouter initialEntries={["/form/form-closed"]}>
        <QueryClientProvider client={createQueryClient()}>
          <Routes>
            <Route path="/form/:id" element={<SurveyPage />} />
          </Routes>
        </QueryClientProvider>
      </MemoryRouter>,
    );

    expect(await screen.findByRole("heading", { name: "404" })).toBeInTheDocument();
    expect(screen.queryByTestId("survey-renderer")).not.toBeInTheDocument();
  });
});
