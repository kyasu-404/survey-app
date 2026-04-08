import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SurveyResponse } from "../../entities/response/types";
import FormResponsesPage from "./FormResponsesPage";

const { getFormById, getResponsesByForm, exportToExcel, showToast } = vi.hoisted(() => ({
  getFormById: vi.fn(),
  getResponsesByForm: vi.fn(),
  exportToExcel: vi.fn(),
  showToast: vi.fn(),
}));

vi.mock("../../entities/survey/api/surveysApi", () => ({
  getFormById,
}));

vi.mock("../../entities/response/api", () => ({
  getResponsesByForm,
}));

vi.mock("../../shared/lib/export", () => ({
  exportToExcel,
}));

vi.mock("../../app/providers/ToastProvider", () => ({
  useToast: () => ({
    showToast,
  }),
}));

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: { retry: false },
    },
  });
}

describe("FormResponsesPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the form title, responses table, and export action", async () => {
    getFormById.mockResolvedValue({
      id: "form-1",
      title: "Форма обратной связи",
      created_at: "2026-04-08T10:00:00.000Z",
      is_public: true,
      author_id: "user-1",
      form_type: "anketa",
      form_reason: "plan",
      deadline_at: null,
      schema: {
        pages: [
          {
            elements: [
              { type: "text", name: "name", title: "Имя" },
            ],
          },
        ],
      },
    });

    const responses: SurveyResponse[] = [
      {
        id: "response-1",
        form_id: "form-1",
        created_at: "2026-04-08T11:30:00.000Z",
        data: {
          name: "Анна",
        },
      },
    ];

    getResponsesByForm.mockResolvedValue(responses);

    render(
      <MemoryRouter initialEntries={["/dashboard/forms/form-1/responses"]}>
        <QueryClientProvider client={createQueryClient()}>
          <Routes>
            <Route path="/dashboard/forms/:id/responses" element={<FormResponsesPage />} />
          </Routes>
        </QueryClientProvider>
      </MemoryRouter>,
    );

    expect(await screen.findByRole("heading", { name: "Форма обратной связи" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Выгрузить в XLSX" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Обновить" })).toBeInTheDocument();
    expect(await screen.findByText("Анна")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Выгрузить в XLSX" }));

    await waitFor(() => {
      expect(exportToExcel).toHaveBeenCalledWith(
        [
          expect.objectContaining({
            Имя: "Анна",
          }),
        ],
        "ответы-Форма обратной связи",
      );
    });
  });
});
