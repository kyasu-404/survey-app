import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { afterEach, expect, it, vi } from "vitest";
import type { SurveyFormSummary } from "../../../entities/survey/types";
import { getDashboardFormsStats } from "../../../entities/survey/api/surveysApi";
import { useDashboardStats } from "./useDashboardStats";

vi.mock("../../../entities/survey/api/surveysApi", () => ({ getDashboardFormsStats: vi.fn() }));

const filters = { dateFrom: "", dateTo: "", formReason: "", formType: "", normalizedSearch: "", listFilters: {} };
const clients: QueryClient[] = [];
function renderStats(forms: SurveyFormSummary[]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  clients.push(client);
  return renderHook(() => useDashboardStats({
    filteredForms: forms, loadedForms: forms, filters, isAuthLoading: false,
    loadedFormsTotalCount: forms.length, userId: "user-1", viewMode: "mine",
  }), { wrapper: ({ children }: PropsWithChildren) => <QueryClientProvider client={client}>{children}</QueryClientProvider> });
}

afterEach(() => {
  clients.splice(0).forEach((client) => client.clear());
  vi.useRealTimers();
  vi.resetAllMocks();
});

it("refreshes statistics when a loaded form's deadline expires without a database event", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2030-01-01T12:00:00Z"));
  vi.mocked(getDashboardFormsStats)
    .mockResolvedValueOnce({ totalCount: 1, activeCount: 1, formsWithDeadlineCount: 1 })
    .mockResolvedValue({ totalCount: 1, activeCount: 0, formsWithDeadlineCount: 0 });
  const { result, unmount } = renderStats([{ id: "form-1", form_type: "anketa", is_public: true, deadline_at: "2030-01-01T12:00:01Z" } as SurveyFormSummary]);
  await act(async () => { await vi.advanceTimersByTimeAsync(1); });
  expect(result.current.activeFormsCount).toBe(1);
  await act(async () => { await vi.advanceTimersByTimeAsync(1250); });
  expect(getDashboardFormsStats).toHaveBeenCalledTimes(2);
  expect(result.current.activeFormsCount).toBe(0);
  unmount();
});

it("rechecks deadlines beyond the loaded cards and stops polling after they expire", async () => {
  vi.useFakeTimers();
  vi.mocked(getDashboardFormsStats)
    .mockResolvedValueOnce({ totalCount: 30, activeCount: 1, formsWithDeadlineCount: 1 })
    .mockResolvedValue({ totalCount: 30, activeCount: 0, formsWithDeadlineCount: 0 });
  const { result, unmount } = renderStats([]);
  await act(async () => { await vi.advanceTimersByTimeAsync(1); });
  await act(async () => { await vi.advanceTimersByTimeAsync(30_001); });
  expect(getDashboardFormsStats).toHaveBeenCalledTimes(2);
  expect(result.current.activeFormsCount).toBe(0);
  await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
  expect(getDashboardFormsStats).toHaveBeenCalledTimes(2);
  unmount();
});
