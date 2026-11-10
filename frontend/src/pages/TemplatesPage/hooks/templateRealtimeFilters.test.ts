import { describe, expect, it } from "vitest";
import { shouldInvalidateTemplates } from "./templateRealtimeFilters";

describe("template realtime filters", () => {
  const options = { cachedIds: new Set(["mine"]), userId: "user-1", section: "mine" as const };
  it("ignores primary-key deletes outside the loaded templates", () => {
    expect(shouldInvalidateTemplates({ ...options, payload: { eventType: "DELETE", old: { id: "regular" } } })).toBe(false);
    expect(shouldInvalidateTemplates({ ...options, payload: { eventType: "DELETE", old: { id: "mine" } } })).toBe(true);
    expect(shouldInvalidateTemplates({ ...options, isFetching: true, payload: { eventType: "DELETE", old: { id: "regular" } } })).toBe(true);
  });
  it("ignores other authors but includes new own templates", () => {
    for (const author_id of ["user-1", "other"]) {
      expect(shouldInvalidateTemplates({ ...options, payload: {
        eventType: "INSERT", new: { id: "new", form_type: "template", author_id },
      } })).toBe(author_id === "user-1");
    }
  });
  it("removes cached templates when their type or visibility changes", () => {
    expect(shouldInvalidateTemplates({ ...options, section: "public", payload: {
      eventType: "UPDATE", old: { id: "mine" }, new: { id: "mine", form_type: "survey", is_public: false },
    } })).toBe(true);
  });
  it("includes only published templates in the public list", () => {
    for (const is_public of [true, false]) {
      expect(shouldInvalidateTemplates({ ...options, section: "public", payload: {
        eventType: "INSERT", new: { id: "new", form_type: "template", is_public },
      } })).toBe(is_public);
    }
  });
});
