import { describe, expect, it } from "vitest";
import type { SurveyForm } from "../types";
import { applyDeadlineStatePatch, buildDeadlineUpdatePayload, getDeadlineStatePatch, getNextDeadlineRefreshDelayMs } from "./deadlineState";

function createForm(overrides: Partial<SurveyForm> = {}): SurveyForm {
  return {
    id: "form-1",
    title: "Форма",
    form_type: "anketa",
    form_reason: "plan",
    is_public: true,
    deadline_at: null,
    author_id: "user-1",
    schema: { pages: [] },
    theme: {},
    created_at: "2026-04-09T10:00:00.000Z",
    ...overrides,
  };
}

describe("deadlineState", () => {
  it("closes the form and clears deadline after it expires", () => {
    const form = createForm({
      is_public: true,
      deadline_at: "2026-04-09T09:59:59.000Z",
    });

    expect(getDeadlineStatePatch(form, new Date("2026-04-09T10:00:00.000Z"))).toEqual({
      is_public: false,
      deadline_at: null,
    });
  });

  it("reopens a closed form while its future deadline has not arrived", () => {
    const form = createForm({
      is_public: false,
      deadline_at: "2026-04-09T12:00:00.000Z",
    });

    expect(getDeadlineStatePatch(form, new Date("2026-04-09T10:00:00.000Z"))).toEqual({
      is_public: true,
      deadline_at: "2026-04-09T12:00:00.000Z",
    });
  });

  it("applies a deadline patch to the displayed form state", () => {
    const form = createForm({
      is_public: true,
      deadline_at: "2026-04-09T12:00:00.000Z",
    });

    expect(
      applyDeadlineStatePatch(form, {
        is_public: false,
        deadline_at: null,
      }),
    ).toMatchObject({
      id: "form-1",
      is_public: false,
      deadline_at: null,
    });
  });

  it("builds an active payload for a future deadline", () => {
    expect(
      buildDeadlineUpdatePayload("2026-04-09T12:00:00.000Z", new Date("2026-04-09T10:00:00.000Z")),
    ).toEqual({
      is_public: true,
      deadline_at: "2026-04-09T12:00:00.000Z",
    });
  });

  it("builds a closed payload when the user sets an already expired deadline", () => {
    expect(
      buildDeadlineUpdatePayload("2026-04-09T09:00:00.000Z", new Date("2026-04-09T10:00:00.000Z")),
    ).toEqual({
      is_public: false,
      deadline_at: null,
    });
  });

  it("returns the closest upcoming deadline refresh delay", () => {
    const delay = getNextDeadlineRefreshDelayMs(
      [
        createForm({ deadline_at: "2026-04-09T10:15:00.000Z" }),
        createForm({ id: "form-2", deadline_at: "2026-04-09T10:05:00.000Z" }),
        createForm({ id: "form-3", form_type: "template", deadline_at: "2026-04-09T10:01:00.000Z" }),
      ],
      new Date("2026-04-09T10:00:00.000Z"),
    );

    expect(delay).toBe(5 * 60 * 1000);
  });
});
