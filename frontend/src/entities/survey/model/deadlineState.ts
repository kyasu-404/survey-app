import type { SurveyForm } from "../types";

export type DeadlineStatePatch = Pick<SurveyForm, "deadline_at" | "is_public">;

type DeadlineTrackedForm = Pick<SurveyForm, "deadline_at" | "form_type" | "is_public">;

export function getDeadlineStatePatch(form: DeadlineTrackedForm, now = new Date()): DeadlineStatePatch | null {
  if (form.form_type === "template" || !form.deadline_at) {
    return null;
  }

  const deadlineMs = Date.parse(form.deadline_at);
  if (Number.isNaN(deadlineMs)) {
    return null;
  }

  if (deadlineMs <= now.getTime()) {
    return {
      is_public: false,
      deadline_at: null,
    };
  }

  if (!form.is_public) {
    return {
      is_public: true,
      deadline_at: form.deadline_at,
    };
  }

  return null;
}

export function applyDeadlineStatePatch<T extends Pick<SurveyForm, "deadline_at" | "is_public">>(
  form: T,
  patch: DeadlineStatePatch,
): T {
  return {
    ...form,
    ...patch,
  };
}

export function buildDeadlineUpdatePayload(deadlineAt: string | null, now = new Date()): Partial<DeadlineStatePatch> {
  if (!deadlineAt) {
    return { deadline_at: null };
  }

  const deadlineMs = Date.parse(deadlineAt);
  if (Number.isNaN(deadlineMs)) {
    return { deadline_at: deadlineAt };
  }

  if (deadlineMs <= now.getTime()) {
    return {
      is_public: false,
      deadline_at: null,
    };
  }

  return {
    is_public: true,
    deadline_at: deadlineAt,
  };
}

export function getNextDeadlineRefreshDelayMs(forms: Array<Pick<SurveyForm, "deadline_at" | "form_type">>, now = new Date()) {
  const nextDeadlineMs = forms.reduce<number | null>((closest, form) => {
    if (form.form_type === "template" || !form.deadline_at) {
      return closest;
    }

    const deadlineMs = Date.parse(form.deadline_at);
    if (Number.isNaN(deadlineMs) || deadlineMs <= now.getTime()) {
      return closest;
    }

    if (closest === null || deadlineMs < closest) {
      return deadlineMs;
    }

    return closest;
  }, null);

  if (nextDeadlineMs === null) {
    return null;
  }

  return Math.max(nextDeadlineMs - now.getTime(), 0);
}
