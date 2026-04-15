import { readFileSync } from "node:fs";
import { join } from "node:path";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import SurveyPage from "./SurveyPage";

const { authState, getFormById, getPublicFormById } = vi.hoisted(() => ({
  authState: {
    user: null as { id: string } | null,
    loading: false,
  },
  getFormById: vi.fn(),
  getPublicFormById: vi.fn(),
}));

vi.mock("../../app/providers/AuthProvider", () => ({
  useAuth: () => authState,
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

function renderSurveyPage({
  queryClient = createQueryClient(),
  initialEntries = ["/form/form-1"],
}: {
  queryClient?: QueryClient;
  initialEntries?: Array<string | { pathname: string; state?: unknown }>;
} = {}) {
  return {
    queryClient,
    ...render(
      <MemoryRouter initialEntries={initialEntries}>
        <QueryClientProvider client={queryClient}>
          <Routes>
            <Route path="/form/:id" element={<SurveyPage />} />
          </Routes>
        </QueryClientProvider>
      </MemoryRouter>,
    ),
  };
}

describe("SurveyPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authState.user = null;
    authState.loading = false;
  });

  it("renders public survey shell hooks", async () => {
    getPublicFormById.mockResolvedValue({
      id: "form-1",
      title: "Анкета",
      is_public: true,
      schema: { pages: [] },
    });

    const { container } = renderSurveyPage();

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
    authState.user = { id: "user-1" };
    getFormById.mockResolvedValue({
      id: "form-1",
      title: "Анкета",
      is_public: false,
      schema: { pages: [] },
    });

    renderSurveyPage({
      initialEntries: [{ pathname: "/form/form-1", state: { isPreview: true } }],
    });

    expect(await screen.findByTestId("survey-renderer")).toHaveAttribute("data-preview", "true");
    expect(getFormById).toHaveBeenCalledWith("form-1");
    expect(getPublicFormById).not.toHaveBeenCalled();
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

    const { container } = renderSurveyPage();

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

  it("starts loading public forms before auth restoration finishes", async () => {
    authState.loading = true;
    getPublicFormById.mockResolvedValue({
      id: "form-1",
      title: "Анкета",
      is_public: true,
      schema: { pages: [] },
    });

    renderSurveyPage();

    await waitFor(() => {
      expect(getPublicFormById).toHaveBeenCalledWith("form-1");
    });
  });

  it("does not reuse the public survey cache for authenticated preview mode", async () => {
    const queryClient = createQueryClient();

    getPublicFormById.mockResolvedValue({
      id: "form-1",
      title: "Публичная анкета",
      is_public: true,
      schema: { pages: [] },
    });

    const publicRender = renderSurveyPage({ queryClient });
    expect(await screen.findByTestId("survey-renderer")).toBeInTheDocument();
    publicRender.unmount();

    authState.user = { id: "user-1" };
    getFormById.mockResolvedValue({
      id: "form-1",
      title: "Приватная анкета",
      is_public: false,
      schema: { pages: [] },
    });

    renderSurveyPage({
      queryClient,
      initialEntries: [{ pathname: "/form/form-1", state: { isPreview: true } }],
    });

    expect(await screen.findByTestId("survey-renderer")).toHaveAttribute("data-preview", "true");
    await waitFor(() => {
      expect(getFormById).toHaveBeenCalledWith("form-1");
    });
  });

  it("keeps the rendered form visible instead of returning to a full-page skeleton after the first load", async () => {
    getPublicFormById.mockResolvedValue({
      id: "form-1",
      title: "Анкета",
      is_public: true,
      schema: { pages: [] },
    });

    const rendered = renderSurveyPage();
    expect(await screen.findByTestId("survey-renderer")).toBeInTheDocument();

    authState.loading = true;
    rendered.rerender(
      <MemoryRouter initialEntries={["/form/form-1"]}>
        <QueryClientProvider client={rendered.queryClient}>
          <Routes>
            <Route path="/form/:id" element={<SurveyPage />} />
          </Routes>
        </QueryClientProvider>
      </MemoryRouter>,
    );

    expect(screen.getByTestId("survey-renderer")).toBeInTheDocument();
    expect(rendered.container.querySelector(".survey-page-skeleton")).not.toBeInTheDocument();
  });

  it("renders 404 page for a missing form", async () => {
    getPublicFormById.mockResolvedValue(null);

    renderSurveyPage({ initialEntries: ["/form/missing"] });

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

    renderSurveyPage({ initialEntries: ["/form/form-closed"] });

    expect(await screen.findByRole("heading", { name: "404" })).toBeInTheDocument();
    expect(screen.queryByTestId("survey-renderer")).not.toBeInTheDocument();
  });
});
