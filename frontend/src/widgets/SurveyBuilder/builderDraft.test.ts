import { afterEach, describe, expect, it, vi } from "vitest";
import type { SurveySchema } from "../../entities/survey/types";
import {
  clearSurveyBuilderDraft,
  getSurveyBuilderDraftStorageKey,
  loadSurveyBuilderDraft,
  saveSurveyBuilderDraft,
} from "./builderDraft";

const schema: SurveySchema = {
  pages: [
    {
      name: "page-1",
      elements: [],
    },
  ],
};

describe("builderDraft", () => {
  afterEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  it("builds distinct localStorage keys for new and existing forms", () => {
    expect(getSurveyBuilderDraftStorageKey()).toBe("survey-builder:draft:new");
    expect(getSurveyBuilderDraftStorageKey("form-42")).toBe("survey-builder:draft:form-42");
  });

  it("saves and restores the current draft payload for a new form", () => {
    saveSurveyBuilderDraft(undefined, schema);

    expect(loadSurveyBuilderDraft()).toEqual(schema);
  });

  it("restores legacy drafts that stored the schema directly", () => {
    window.localStorage.setItem(getSurveyBuilderDraftStorageKey("form-9"), JSON.stringify(schema));

    expect(loadSurveyBuilderDraft("form-9")).toEqual(schema);
  });

  it("returns null and warns when draft JSON is corrupted", () => {
    const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    window.localStorage.setItem(getSurveyBuilderDraftStorageKey(), "{broken");

    expect(loadSurveyBuilderDraft()).toBeNull();
    expect(consoleWarnSpy).toHaveBeenCalledTimes(1);
  });

  it("clears only the requested draft key", () => {
    saveSurveyBuilderDraft(undefined, schema);
    saveSurveyBuilderDraft("form-7", schema);

    clearSurveyBuilderDraft("form-7");

    expect(loadSurveyBuilderDraft("form-7")).toBeNull();
    expect(loadSurveyBuilderDraft()).toEqual(schema);
  });
});
