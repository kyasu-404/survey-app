import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import BuilderPage from "./BuilderPage";

const { authState, cloneForm, getFormById, showToast } = vi.hoisted(() => ({
  authState: {
    user: { id: "user-1" } as { id: string } | null,
    profile: { role: "user" } as { role: string } | null,
  },
  cloneForm: vi.fn(),
  getFormById: vi.fn(),
  showToast: vi.fn(),
}));

vi.mock("../../app/providers/AuthProvider", () => ({
  useAuth: () => authState,
}));

vi.mock("../../app/providers/ToastProvider", () => ({
  useToast: () => ({ showToast }),
}));

vi.mock("../../entities/survey/api/surveysApi", () => ({
  cloneForm,
  getFormById,
}));

vi.mock("../../widgets/SurveyBuilder/SurveyBuilder", () => ({
  SurveyBuilder: ({ formId }: { formId?: string }) => <div data-testid="survey-builder">{formId}</div>,
}));

const answeredForm = {
  id: "form-1",
  title: "Анкета",
  form_type: "Опрос",
  form_reason: "Обратная связь",
  is_public: true,
  deadline_at: null,
  allow_response_editing: true,
  author_id: "user-1",
  schema: { pages: [] },
  theme: {},
  created_at: "2026-08-03T12:00:00.000Z",
  responses_count: 2,
};

function renderBuilderPage() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });

  return render(
    <MemoryRouter initialEntries={["/builder/form-1"]}>
      <QueryClientProvider client={queryClient}>
        <Routes>
          <Route path="/builder/copy-1" element={<div>Копия открыта</div>} />
          <Route path="/builder/:id" element={<BuilderPage />} />
          <Route path="/dashboard/my" element={<div>Мои формы</div>} />
        </Routes>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe("BuilderPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authState.user = { id: "user-1" };
    authState.profile = { role: "user" };
  });

  it("blocks editing an answered form and creates a copy on request", async () => {
    getFormById.mockResolvedValue(answeredForm);
    cloneForm.mockResolvedValue({ id: "copy-1" });

    renderBuilderPage();

    expect(await screen.findByRole("alertdialog")).toHaveTextContent("У формы уже есть ответы");
    expect(screen.getByRole("alertdialog")).toHaveTextContent(
      "Создайте её копию, чтобы не нарушить существующие данные.",
    );
    expect(screen.queryByTestId("survey-builder")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Создать копию" }));

    await waitFor(() => expect(cloneForm).toHaveBeenCalledWith(answeredForm, "user-1"));
    expect(await screen.findByText("Копия открыта")).toBeInTheDocument();
    expect(showToast).toHaveBeenCalledWith("Копия формы создана", "success");
  });

  it("opens the builder when the form has no responses", async () => {
    getFormById.mockResolvedValue({ ...answeredForm, responses_count: 0 });

    renderBuilderPage();

    expect(await screen.findByTestId("survey-builder")).toHaveTextContent("form-1");
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("returns to the dashboard when the warning is cancelled", async () => {
    getFormById.mockResolvedValue(answeredForm);

    renderBuilderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Отмена" }));

    expect(await screen.findByText("Мои формы")).toBeInTheDocument();
    expect(cloneForm).not.toHaveBeenCalled();
  });
});
