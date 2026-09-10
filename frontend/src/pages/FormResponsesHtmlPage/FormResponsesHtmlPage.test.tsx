import { focusManager, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SurveyResponse } from "../../entities/response/types";
import FormResponsesHtmlPage from "./FormResponsesHtmlPage";

const { getFormById, getOrganizations, getResponsesByForm, downloadHtmlDocument } = vi.hoisted(() => ({
  getFormById: vi.fn(),
  getOrganizations: vi.fn(),
  getResponsesByForm: vi.fn(),
  downloadHtmlDocument: vi.fn(),
}));

vi.mock("../../entities/organization/api", () => ({
  getOrganizations,
}));

vi.mock("../../entities/survey/api/surveysApi", () => ({
  getFormById,
}));

vi.mock("../../entities/response/api", () => ({
  getResponsesByForm,
}));

vi.mock("../../shared/lib/responsesExport", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../shared/lib/responsesExport")>();
  return {
    ...actual,
    downloadHtmlDocument,
  };
});

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: { retry: false },
    },
  });
}

function renderHtmlPage() {
  return render(
    <MemoryRouter initialEntries={["/dashboard/forms/form-1/responses/html"]}>
      <QueryClientProvider client={createQueryClient()}>
        <Routes>
          <Route path="/dashboard/forms/:id/responses/html" element={<FormResponsesHtmlPage />} />
        </Routes>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

function createResponsesPage(data: SurveyResponse[], overrides: Partial<{
  count: number;
  page: number;
  pageSize: number;
  totalPages: number;
}> = {}) {
  return {
    data,
    count: data.length,
    page: 1,
    pageSize: 50,
    totalPages: 1,
    ...overrides,
  };
}

function readAppCss() {
  return readFileSync(join(process.cwd(), "src/app.css"), "utf8");
}

describe("FormResponsesHtmlPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getOrganizations.mockResolvedValue([]);
  });

  it("uses the branded browser tab title", () => {
    const html = readFileSync(join(process.cwd(), "index.html"), "utf8");

    expect(html).toContain("<title>Формы ИМЦ</title>");
  });

  it("uses a slightly smaller text scale for the HTML responses preview", () => {
    const css = readAppCss();

    expect(css).toMatch(/\.responses-html-preview\s+\.responses-html-report\s*\{[^}]*font-size:\s*13px;/);
    expect(css).toMatch(/\.responses-html-preview h1\s*\{[^}]*font-size:\s*1\.75rem;/);
    expect(css).toMatch(/\.responses-html-preview table\s*\{[^}]*font-size:\s*13px;/);
  });

  it("keeps the light HTML response document readable in the graphite theme", () => {
    const css = readAppCss();

    expect(css).toMatch(/:root\[data-theme="graphite"\] \.responses-html-preview \.responses-html-report,[^{]+\.report-meta dd,[^{]+\.responses-table-wrap,[^{]+table,[^{]+td,[^{]+\.empty-state h2\s*\{[^}]*color:\s*#111827;/s);
    expect(css).toMatch(/:root\[data-theme="graphite"\] \.responses-html-preview td\s*\{[^}]*border-color:\s*#d8dee8;[^}]*background:\s*#ffffff;/s);
  });

  it("keeps the HTML response date column wide enough for bordered cells", () => {
    const css = readAppCss();

    expect(css).toMatch(/\.responses-html-preview \.responses-table-date-column\s*\{[^}]*width:\s*12ch;[^}]*min-width:\s*12ch;/);
    expect(css).toMatch(/\.responses-html-preview \.responses-table-date-cell\s*\{[^}]*width:\s*max-content;[^}]*min-width:\s*10ch;/);
  });

  it("wraps long HTML response headers and cell values inside the preview table", () => {
    const css = readAppCss();

    expect(css).toMatch(
      /\.responses-html-preview th,\s*\.responses-html-preview td\s*\{[^}]*white-space:\s*normal;[^}]*overflow-wrap:\s*anywhere;[^}]*word-break:\s*break-word;[^}]*max-width:\s*min\(28rem,\s*40vw\);/s,
    );
  });

  it("styles the print button as a secondary monochrome action with a matching icon", () => {
    const css = readAppCss();

    expect(css).toMatch(/\.responses-print-button-secondary\s*\{[^}]*background:\s*linear-gradient\(180deg,\s*#ffffff,\s*#f4f4f5\);[^}]*color:\s*#111827;/);
    expect(css).toMatch(/\.responses-print-button-secondary:hover,\s*\.responses-print-button-secondary:focus-visible\s*\{[^}]*background:\s*linear-gradient\(180deg,\s*#f4f4f5,\s*#e4e4e7\);[^}]*color:\s*#111827;/);
    expect(css).toMatch(/\.responses-print-button-secondary\s+\.toolbar-icon\s*\{[^}]*filter:\s*brightness\(0\);/);
  });

  it("uses monochrome primary styling with matching icons for export buttons and borders every HTML response table cell", () => {
    const css = readAppCss();

    expect(css).toMatch(/button\.responses-export-button\s*\{[^}]*background:\s*linear-gradient\(180deg,\s*#27272a,\s*#111111\);[^}]*color:\s*#ffffff;/);
    expect(css).toMatch(/button\.responses-export-button:hover,\s*button\.responses-export-button:focus-visible\s*\{[^}]*background:\s*linear-gradient\(180deg,\s*#3f3f46,\s*#18181b\);[^}]*color:\s*#ffffff;/);
    expect(css).toMatch(/\.responses-export-button\s+\.toolbar-icon\s*\{[^}]*filter:\s*brightness\(0\)\s*invert\(1\);/);
    expect(css).toMatch(/\.responses-html-preview th,\s*\.responses-html-preview td\s*\{[^}]*border:\s*1px solid #d8dee8;/);
    expect(css).toMatch(/\.responses-html-preview tr:last-child td\s*\{[^}]*border-bottom:\s*1px solid #d8dee8;/);
  });

  it("renders generated static HTML preview actions and response rows", async () => {
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
              {
                type: "radiogroup",
                name: "mood",
                title: "Настроение",
                choices: [{ value: "good", text: "Хорошее" }],
              },
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
          mood: "good",
        },
      },
    ];

    getResponsesByForm.mockResolvedValue(createResponsesPage(responses));

    const { container } = renderHtmlPage();

    expect(await screen.findByRole("heading", { name: "Форма обратной связи" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Скачать HTML" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Печать" })).toHaveClass("responses-print-button-secondary");
    expect(container.querySelector(".responses-print-button .toolbar-icon")).toBeInTheDocument();
    expect(screen.getByText("Анна", { selector: ".responses-report-screen td" })).toBeInTheDocument();
    expect(screen.getByText("Хорошее", { selector: ".responses-report-screen td" })).toBeInTheDocument();
  });

  it.each([51, 100, 200])("loads all %i responses for the HTML report without requesting a page beyond the total", async (total) => {
    getFormById.mockResolvedValue({
      id: "form-1",
      title: "Полный отчёт",
      created_at: "2026-04-08T10:00:00.000Z",
      is_public: true,
      author_id: "user-1",
      form_type: "anketa",
      form_reason: "plan",
      deadline_at: null,
      schema: { pages: [{ elements: [{ type: "text", name: "name", title: "Имя" }] }] },
    });
    const responses = Array.from({ length: total }, (_, index): SurveyResponse => ({
      id: `response-${index + 1}`,
      form_id: "form-1",
      created_at: "2026-04-08T11:30:00.000Z",
      data: { name: `Ответ ${index + 1}` },
    }));
    getResponsesByForm.mockImplementation(async (_formId: string, options: { page?: number }) => {
      const page = options.page ?? 1;
      const offset = (page - 1) * 50;
      if (offset >= total) throw new Error("PGRST103: requested range not satisfiable");
      return createResponsesPage(responses.slice(offset, offset + 50), { count: total, page });
    });

    renderHtmlPage();

    expect(await screen.findByText(`Ответ ${total}`, { selector: ".responses-report-screen td" })).toBeInTheDocument();
    expect(getResponsesByForm).toHaveBeenCalledWith("form-1", expect.objectContaining({ page: 2 }));
    expect(getResponsesByForm).toHaveBeenCalledTimes(Math.ceil(total / 50));
  });

  it("resolves organization identifiers in both the HTML preview and downloaded document", async () => {
    const organizationId = "9a109521-b000-4d86-909e-119fa58594c9";
    getFormById.mockResolvedValue({
      id: "form-1",
      title: "Мониторинг организаций",
      created_at: "2026-04-08T10:00:00.000Z",
      is_public: true,
      author_id: "user-1",
      form_type: "monitoring",
      form_reason: "order",
      deadline_at: null,
      organization_types: ["school"],
      schema: {
        pages: [
          {
            elements: [
              { type: "organization", name: "organization", title: "Организация" },
            ],
          },
        ],
      },
    });
    getOrganizations.mockResolvedValue([
      {
        id: organizationId,
        organization_type: "school",
        number: "1",
        alias: "ИМЦ",
        email: "imc@example.test",
        created_at: "2026-04-01T10:00:00.000Z",
        updated_at: "2026-04-01T10:00:00.000Z",
      },
    ]);
    getResponsesByForm.mockResolvedValue(createResponsesPage([
      {
        id: "response-organization",
        form_id: "form-1",
        created_at: "2026-04-08T11:30:00.000Z",
        data: { organization: organizationId },
      },
    ]));

    renderHtmlPage();

    expect(await screen.findByText("ИМЦ 1", { selector: ".responses-report-screen td" })).toBeInTheDocument();
    expect(screen.queryByText(organizationId)).not.toBeInTheDocument();
    expect(getOrganizations).toHaveBeenCalledWith(["school"], expect.any(AbortSignal));

    await userEvent.click(screen.getByRole("button", { name: "Скачать HTML" }));

    expect(downloadHtmlDocument).toHaveBeenCalledWith(
      expect.stringContaining("ИМЦ 1"),
      "ответы-Мониторинг организаций",
    );
    expect(downloadHtmlDocument.mock.calls[0]?.[0]).not.toContain(organizationId);
  });

  it("does not refresh the static HTML report when the browser tab becomes focused again", async () => {
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
            elements: [{ type: "text", name: "name", title: "Имя" }],
          },
        ],
      },
    });
    getResponsesByForm.mockResolvedValueOnce(createResponsesPage([
      {
        id: "response-1",
        form_id: "form-1",
        created_at: "2026-04-08T11:30:00.000Z",
        data: { name: "Анна" },
      },
    ]));

    renderHtmlPage();

    expect(await screen.findByText("Анна", { selector: ".responses-report-screen td" })).toBeInTheDocument();

    await waitFor(() => {
      expect(getFormById).toHaveBeenCalledTimes(1);
      expect(getResponsesByForm).toHaveBeenCalledTimes(1);
    });

    await act(async () => {
      focusManager.setFocused(false);
      focusManager.setFocused(true);
    });

    await waitFor(() => {
      expect(getFormById).toHaveBeenCalledTimes(1);
      expect(getResponsesByForm).toHaveBeenCalledTimes(1);
    }, { timeout: 100 });
  });

  it("downloads the generated HTML document and prints the page", async () => {
    const print = vi.spyOn(window, "print").mockImplementation(() => undefined);

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
            elements: [{ type: "text", name: "name", title: "Имя" }],
          },
        ],
      },
    });

    getResponsesByForm.mockResolvedValue(createResponsesPage([
      {
        id: "response-1",
        form_id: "form-1",
        created_at: "2026-04-08T11:30:00.000Z",
        data: { name: "Анна" },
      },
    ]));

    renderHtmlPage();

    await userEvent.click(await screen.findByRole("button", { name: "Скачать HTML" }));

    await waitFor(() => {
      expect(downloadHtmlDocument).toHaveBeenCalledWith(
        expect.stringContaining("Анна"),
        "ответы-Форма обратной связи",
      );
    });

    await userEvent.click(screen.getByRole("button", { name: "Печать" }));

    expect(print).toHaveBeenCalled();
    print.mockRestore();
  });
});
