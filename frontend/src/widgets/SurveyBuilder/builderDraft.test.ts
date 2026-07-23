import { afterEach, describe, expect, it, vi } from "vitest";
import type { SurveySchema } from "../../entities/survey/types";
import {
  clearSurveyBuilderDraft,
  getSurveyBuilderDraftStorageKey,
  loadSurveyBuilderDraft,
  saveSurveyBuilderDraft,
} from "./builderDraft";

const schema: SurveySchema = {
  pages: [{ name: "page-1", elements: [] }],
};

describe("builderDraft", () => {
  afterEach(() => {
    window.localStorage.clear();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("scopes keys by user and form", () => {
    expect(getSurveyBuilderDraftStorageKey("user-1")).toBe("survey-builder:draft:user-1:new");
    expect(getSurveyBuilderDraftStorageKey("user-2", "form-42")).toBe("survey-builder:draft:user-2:form-42");
  });

  it("does not expose a draft to another account", () => {
    saveSurveyBuilderDraft("user-1", undefined, schema);
    expect(loadSurveyBuilderDraft("user-1")).toMatchObject({ schema, theme: expect.any(Object) });
    expect(loadSurveyBuilderDraft("user-2")).toBeNull();
  });

  it("deletes rather than restores a legacy unscoped draft", () => {
    window.localStorage.setItem("survey-builder:draft:form-9", JSON.stringify(schema));
    expect(loadSurveyBuilderDraft("user-1", "form-9")).toBeNull();
    expect(window.localStorage.getItem("survey-builder:draft:form-9")).toBeNull();
  });

  it("removes expired drafts", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    saveSurveyBuilderDraft("user-1", undefined, schema);
    vi.setSystemTime(new Date("2026-01-09T00:00:00.000Z"));
    expect(loadSurveyBuilderDraft("user-1")).toBeNull();
  });

  it("clears only the requested owner draft", () => {
    saveSurveyBuilderDraft("user-1", "form-7", schema);
    saveSurveyBuilderDraft("user-2", "form-7", schema);
    clearSurveyBuilderDraft("user-1", "form-7");
    expect(loadSurveyBuilderDraft("user-1", "form-7")).toBeNull();
    expect(loadSurveyBuilderDraft("user-2", "form-7")).toMatchObject({ schema, theme: expect.any(Object) });
  });
});
