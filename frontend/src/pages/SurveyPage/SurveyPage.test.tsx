import { readFileSync } from "node:fs";
import { join } from "node:path";
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
  SurveyRenderer: ({ isPreview }: { isPreview?: boolean }) => (
    <div data-testid="survey-renderer" data-preview={String(Boolean(isPreview))} />
  ),
}));

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });
}

function readAppCss() {
  return readFileSync(join(process.cwd(), "src/app.css"), "utf8");
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

  it("lets the page, not the survey card, own scrolling so dropdowns do not shift the form", () => {
    const css = readAppCss();

    expect(css).toMatch(/\.survey-page\s*\{[^}]*align-items:\s*flex-start;[^}]*overflow-x:\s*clip;/);
    expect(css).toMatch(/\.survey-page-card\s*\{[^}]*min-width:\s*0;[^}]*max-height:\s*none;[^}]*overflow:\s*visible;/);
    expect(css).toMatch(/\.survey-page-card\s+\.sd-root-modern,\s*\.survey-page-card\s+\.sd-root-modern__wrapper\s*\{[^}]*min-width:\s*0;[^}]*overflow:\s*visible;/);
  });

  it("opens dashboard card navigation as readonly preview", async () => {
    getPublicFormById.mockResolvedValue({
      id: "form-1",
      title: "Анкета",
      is_public: true,
      schema: { pages: [] },
    });

    render(
      <MemoryRouter initialEntries={[{ pathname: "/form/form-1", state: { isPreview: true } }]}>
        <QueryClientProvider client={createQueryClient()}>
          <Routes>
            <Route path="/form/:id" element={<SurveyPage />} />
          </Routes>
        </QueryClientProvider>
      </MemoryRouter>,
    );

    expect(await screen.findByTestId("survey-renderer")).toHaveAttribute("data-preview", "true");
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
