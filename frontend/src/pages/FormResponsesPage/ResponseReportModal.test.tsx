import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { ResponseReport } from "../../shared/lib/responseReport";
import { ResponseReportModal } from "./ResponseReportModal";

const { queueFormRemindersMock, showToastMock } = vi.hoisted(() => ({
  queueFormRemindersMock: vi.fn(),
  showToastMock: vi.fn(),
}));

vi.mock("../../app/providers/ToastProvider", () => ({
  useToast: () => ({ showToast: showToastMock }),
}));

vi.mock("../../entities/mail/api", () => ({
  queueFormReminders: (...args: unknown[]) => queueFormRemindersMock(...args),
  getFormMailActivity: vi.fn().mockResolvedValue({ batches: [], jobs: [] }),
}));

vi.mock("./MailDeliveryPanel", () => ({
  MailDeliveryPanel: () => <div>Журнал отправки</div>,
}));

const baseReport: ResponseReport = {
  totalResponses: 2,
  questionReports: [{
    name: "choice",
    title: "Выберите вариант",
    type: "radiogroup",
    kind: "single-choice",
    answeredCount: 2,
    missingCount: 0,
    metrics: [{ label: "Ответили", value: "2" }],
    values: [
      { label: "Да", count: 1, percentage: 50 },
      { label: "Нет", count: 1, percentage: 50 },
    ],
    groups: [],
  }],
  organizationCoverage: null,
};

const submittedOrganization = {
  id: "org-1",
  organization_type: "school" as const,
  number: "1",
  alias: "ГБОУ",
  email: "one@example.ru",
  created_at: "2026-08-03T00:00:00.000Z",
  updated_at: "2026-08-03T00:00:00.000Z",
};

const missingOrganization = {
  ...submittedOrganization,
  id: "org-2",
  number: "2",
  email: "two@example.ru",
};

describe("ResponseReportModal", () => {
  it("shows type-specific statistics and disables submission tracking without an organization field", () => {
    render(<ResponseReportModal report={baseReport} formId="form-1" canSendReminders onClose={vi.fn()} />);

    expect(screen.getByRole("tab", { name: "Статистика" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Учёт сдавших" })).toBeDisabled();
    expect(screen.getByText("Распределение ответов")).toBeInTheDocument();
    expect(screen.getAllByText("1 · 50%", { selector: "strong" })).toHaveLength(2);
    expect(screen.getByText(/Учёт сдавших недоступен/)).toBeInTheDocument();
    expect(screen.queryByText(/Пропущено:/)).not.toBeInTheDocument();
  });

  it("separates organization submission tracking into its own tab", async () => {
    render(
      <ResponseReportModal
        report={{
          ...baseReport,
          organizationCoverage: {
            expectedCount: 2,
            submittedCount: 1,
            submittedOrganizations: [submittedOrganization],
            missingOrganizations: [missingOrganization],
          },
        }}
        formId="form-1"
        canSendReminders
        onClose={vi.fn()}
      />,
    );

    await userEvent.click(screen.getByRole("tab", { name: "Учёт сдавших" }));

    expect(screen.getByRole("heading", { name: "Статус сдачи" })).toBeInTheDocument();
    expect(screen.getByText("Сдано")).toBeInTheDocument();
    expect(screen.getByText("Не сдано")).toBeInTheDocument();
    expect(screen.queryByText("Выберите вариант")).not.toBeInTheDocument();
  });

  it("confirms and queues one reminder batch for missing organizations", async () => {
    queueFormRemindersMock.mockResolvedValueOnce({ batchId: "batch-1", queuedCount: 1 });
    render(
      <ResponseReportModal
        report={{
          ...baseReport,
          organizationCoverage: {
            expectedCount: 1,
            submittedCount: 0,
            submittedOrganizations: [],
            missingOrganizations: [missingOrganization],
          },
        }}
        formId="form-1"
        canSendReminders
        onClose={vi.fn()}
      />,
    );

    await userEvent.click(screen.getByRole("tab", { name: "Учёт сдавших" }));
    await userEvent.click(screen.getByRole("button", { name: "Отправить напоминание" }));
    expect(screen.getByText("Отправить на почту напоминания организациям, которые не предоставили ответ?")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Да" }));

    expect(queueFormRemindersMock).toHaveBeenCalledWith("form-1");
  });
});
