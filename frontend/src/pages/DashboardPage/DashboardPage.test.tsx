import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import DashboardPage from "./DashboardPage";

const { showToast, navigate, getForms, cloneForm } = vi.hoisted(() => ({
  showToast: vi.fn(),
  navigate: vi.fn(),
  getForms: vi.fn(),
  cloneForm: vi.fn(),
}));

vi.mock("../../app/providers/AuthProvider", () => ({
  useAuth: () => ({
    user: { id: "user-1" },
    loading: false,
  }),
}));

vi.mock("../../app/providers/ToastProvider", () => ({
  useToast: () => ({
    showToast,
  }),
}));

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");

  return {
    ...actual,
    useNavigate: () => navigate,
  };
});

vi.mock("../../entities/survey/api/surveysApi", () => ({
  getForms,
  cloneForm,
  renameForm: vi.fn(),
  removeForm: vi.fn(),
  changeFormStatus: vi.fn(),
  setFormDeadline: vi.fn(),
}));

vi.mock("../../entities/response/api", () => ({
  getResponsesByForm: vi.fn(),
}));

vi.mock("../../shared/lib/browser", () => ({
  copyTextToClipboard: vi.fn(),
}));

vi.mock("../../shared/lib/export", () => ({
  exportToExcel: vi.fn(),
}));

describe("DashboardPage", () => {
  it("re-enables action buttons after mutation even when cache invalidation hangs", async () => {
    getForms.mockResolvedValue([
      {
        id: "form-1",
        title: "Test form",
        created_at: "2026-04-08T10:00:00.000Z",
        is_public: true,
        author_id: "user-2",
        author_name: "Another User",
        author_email: "another@example.com",
        form_type: "anketa",
        form_reason: "plan",
        deadline_at: null,
        responses_count: 0,
        schema: { pages: [] },
      },
    ]);
    cloneForm.mockResolvedValue({ id: "form-2" });

    const queryClient = new QueryClient({
      defaultOptions: {
        mutations: { retry: false },
        queries: { retry: false },
      },
    });

    vi.spyOn(queryClient, "invalidateQueries").mockImplementation(
      () =>
        new Promise(() => {
          return undefined;
        }),
    );
    vi.spyOn(queryClient, "refetchQueries").mockImplementation(
      () =>
        new Promise(() => {
          return undefined;
        }),
    );

    render(
      <MemoryRouter>
        <QueryClientProvider client={queryClient}>
          <DashboardPage viewMode="all" />
        </QueryClientProvider>
      </MemoryRouter>,
    );

    const duplicateButton = await screen.findByRole("button", { name: "Дублировать" });
    await userEvent.click(duplicateButton);

    await waitFor(() => {
      expect(cloneForm).toHaveBeenCalledWith(
        expect.objectContaining({ id: "form-1" }),
        "user-1",
      );
    });

    await waitFor(() => {
      expect(duplicateButton).not.toBeDisabled();
    });
  });
});
