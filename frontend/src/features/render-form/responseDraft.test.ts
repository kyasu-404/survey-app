import { afterEach, expect, it, vi } from "vitest";
import { clearSurveyResponseDraft, cleanupExpiredSurveyResponseDrafts, getSurveyResponseDraftStorageKey, loadSurveyResponseDraft, saveSurveyResponseDraft } from "./responseDraft";

afterEach(() => { vi.restoreAllMocks(); sessionStorage.clear(); localStorage.clear(); });

it("keeps a valid draft and removes it after submission", () => {
  const key = getSurveyResponseDraftStorageKey("form", "employee");
  saveSurveyResponseDraft(key, { data: { answer: "saved" }, submissionId: "submission" });
  expect(loadSurveyResponseDraft(key)).toMatchObject({ data: { answer: "saved" }, submissionId: "submission" });
  clearSurveyResponseDraft(key);
  expect(loadSurveyResponseDraft(key)).toBeNull();
});

it.each(["sessionStorage", "localStorage"] as const)("continues without drafts when the %s getter is blocked", (name) => {
  vi.spyOn(window, name, "get").mockImplementation(() => { throw new DOMException("blocked", "SecurityError"); });
  expect(() => {
    const key = getSurveyResponseDraftStorageKey("form");
    loadSurveyResponseDraft(key);
    saveSurveyResponseDraft(key, { data: { answer: "test" } });
    clearSurveyResponseDraft(key);
    cleanupExpiredSurveyResponseDrafts();
  }).not.toThrow();
});

it.each(["getItem", "setItem", "removeItem", "key"] as const)("tolerates a blocked Storage.%s operation", (name) => {
  const key = getSurveyResponseDraftStorageKey("form", "employee");
  saveSurveyResponseDraft(key, { data: { answer: "saved" } });
  vi.spyOn(Storage.prototype, name).mockImplementation(() => { throw new DOMException("blocked", "SecurityError"); });
  expect(() => {
    loadSurveyResponseDraft(key);
    saveSurveyResponseDraft(key, { data: { answer: "changed" } });
    clearSurveyResponseDraft(key);
    cleanupExpiredSurveyResponseDrafts();
  }).not.toThrow();
});
