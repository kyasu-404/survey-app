import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { routes } from "../../app/routes";
import FormResponsesPage from "./FormResponsesPage";

const { showToast, getFormById, getResponsesByForm, exportToExcel } = vi.hoisted(() => ({
  showToast: vi.fn(),
  getFormById: vi.fn(),
  getResponsesByForm: vi.fn(),
  exportToExcel: vi.fn(),
}));

vi.mock("../../app/providers/ToastProvider", () => ({
  useToast: () => ({
    showToast,
  }),
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

describe("FormResponsesPage", () => {
  it("renders summary modules, table of responses, and refresh/export actions", async () => {
    getFormById.mockResolvedValue({
      id: "form-1",
      title: "Опрос сотрудников",
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
              {
                type: "radiogroup",
                name: "department",
                choices: [{ value: "it", text: "IT" }],
              },
            ],
          },
        ],
      },
    });
    getResponsesByForm.mockResolvedValue([
      {
        id: "response-1",
        form_id: "form-1",
        created_at: "2026-04-09T10:00:00.000Z",
        data: {
          department: "it",
          comment: "Все отлично",
        },
      },
    ]);

    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    });

    render(
      <MemoryRouter initialEntries={[routes.formResponses("form-1")]}>
        <QueryClientProvider client={queryClient}>
          <Routes>
            <Route path={routes.formResponsesById} element={<FormResponsesPage />} />
          </Routes>
        </QueryClientProvider>
      </MemoryRouter>,
    );

    expect(await screen.findByRole("heading", { name: "Опрос сотрудников" })).toBeInTheDocument();

    const totalResponsesCard = screen.getByText("Всего ответов").closest("article");
    const latestResponseCard = screen.getByText("Последний ответ").closest("article");

    expect(totalResponsesCard).not.toBeNull();
    expect(latestResponseCard).not.toBeNull();
    expect(totalResponsesCard).toHaveTextContent("1");
    expect(latestResponseCard).toHaveTextContent(/апреля/);
    expect(screen.getByRole("button", { name: "Выгрузить в XLSX" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Обновить" })).toBeInTheDocument();

    expect(await screen.findByRole("columnheader", { name: "Дата ответа" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "department" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "comment" })).toBeInTheDocument();
    expect(screen.getByText("IT")).toBeInTheDocument();
    expect(screen.getByText("Все отлично")).toBeInTheDocument();
  });

  it("exports responses to xlsx from the dedicated page", async () => {
    getFormById.mockResolvedValue({
      id: "form-1",
      title: "Опрос сотрудников",
      created_at: "2026-04-08T10:00:00.000Z",
      is_public: true,
      author_id: "user-1",
      form_type: "anketa",
      form_reason: "plan",
      deadline_at: null,
      schema: { pages: [] },
    });
    getResponsesByForm.mockResolvedValue([
      {
        id: "response-1",
        form_id: "form-1",
        created_at: "2026-04-09T10:00:00.000Z",
        data: {
          name: "Анна",
        },
      },
    ]);

    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    });

    render(
      <MemoryRouter initialEntries={[routes.formResponses("form-1")]}>
        <QueryClientProvider client={queryClient}>
          <Routes>
            <Route path={routes.formResponsesById} element={<FormResponsesPage />} />
          </Routes>
        </QueryClientProvider>
      </MemoryRouter>,
    );

    await screen.findByRole("heading", { name: "Опрос сотрудников" });
    await userEvent.click(screen.getByRole("button", { name: "Выгрузить в XLSX" }));

    await waitFor(() => {
      expect(exportToExcel).toHaveBeenCalledWith(
        [
          expect.objectContaining({
            name: "Анна",
          }),
        ],
        "ответы-Опрос сотрудников",
      );
    });
  });
});
