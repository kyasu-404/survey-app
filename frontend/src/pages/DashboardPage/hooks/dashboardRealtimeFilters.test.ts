import { describe, expect, it } from "vitest";
import type { DashboardListFilters } from "../types";
import { shouldInvalidateDashboardForms, shouldInvalidateDashboardFormStats } from "./dashboardRealtimeFilters";

function createRealtimeForm(overrides: Record<string, unknown> = {}) {
  return {
    id: "form-1",
    title: "Плановый опрос",
    form_type: "survey",
    form_reason: "request",
    is_public: true,
    deadline_at: null,
    max_responses: null,
    responses_count: 0,
    author_id: "user-1",
    author_name: "Администратор",
    created_at: "2026-04-15T10:00:00.000Z",
    ...overrides,
  };
}

const filters: DashboardListFilters = {
  dateFrom: "2026-04-01",
  dateTo: "2026-04-30",
  formReason: "request",
  formType: "survey",
  search: "опрос",
};

describe("shouldInvalidateDashboardForms", () => {
  it("skips updates when both previous and next forms are outside the current filters", () => {
    const outsideForm = createRealtimeForm({
      id: "form-2",
      title: "Нерелевантный мониторинг",
      form_type: "monitoring",
      form_reason: "order",
    });

    expect(
      shouldInvalidateDashboardForms({
        filters,
        payload: {
          eventType: "UPDATE",
          new: outsideForm,
          old: { ...outsideForm, deadline_at: null },
        },
      }),
    ).toBe(false);
  });

  it("invalidates when a form enters the current filters", () => {
    expect(
      shouldInvalidateDashboardForms({
        filters,
        payload: {
          eventType: "UPDATE",
          new: createRealtimeForm(),
          old: createRealtimeForm({
            form_type: "monitoring",
            form_reason: "order",
          }),
        },
      }),
    ).toBe(true);
  });

  it("invalidates when a form leaves the current filters", () => {
    expect(
      shouldInvalidateDashboardForms({
        filters,
        payload: {
          eventType: "UPDATE",
          new: createRealtimeForm({
            form_type: "monitoring",
            form_reason: "order",
          }),
          old: createRealtimeForm(),
        },
      }),
    ).toBe(true);
  });

  it("skips updates that only touch fields outside the dashboard list and stats", () => {
    const form = createRealtimeForm();

    expect(
      shouldInvalidateDashboardForms({
        filters,
        payload: {
          eventType: "UPDATE",
          new: { ...form, schema: { pages: [{ name: "page-2" }] } },
          old: { ...form, schema: { pages: [{ name: "page-1" }] } },
        },
      }),
    ).toBe(false);
  });

  it("invalidates cached rows even when an incomplete payload cannot be matched against filters", () => {
    expect(
      shouldInvalidateDashboardForms({
        cachedFormIds: new Set(["form-7"]),
        filters,
        payload: {
          eventType: "UPDATE",
          new: { id: "form-7", title: "Новое название" },
          old: { id: "form-7", title: "Старое название" },
        },
      }),
    ).toBe(true);
  });

  it("keeps response count-only updates out of dashboard stats invalidation", () => {
    const form = createRealtimeForm({ responses_count: 1 });
    const payload = {
      eventType: "UPDATE",
      new: { ...form, responses_count: 2 },
      old: form,
    };

    expect(
      shouldInvalidateDashboardForms({
        filters,
        payload,
      }),
    ).toBe(true);
    expect(
      shouldInvalidateDashboardFormStats({
        filters,
        payload,
      }),
    ).toBe(false);
  });

  it("invalidates dashboard stats when a stats counter can change", () => {
    const form = createRealtimeForm({ deadline_at: null });

    expect(
      shouldInvalidateDashboardFormStats({
        filters,
        payload: {
          eventType: "UPDATE",
          new: { ...form, deadline_at: "2026-04-20T10:00:00.000Z" },
          old: form,
        },
      }),
    ).toBe(true);
  });
});
