import { afterEach, expect, it, vi } from "vitest";

afterEach(() => vi.restoreAllMocks());

it.each(["getItem", "setItem"] as const)("keeps a stable in-memory capability when localStorage.%s is blocked", async (method) => {
  vi.resetModules();
  localStorage.clear();
  vi.spyOn(Storage.prototype, method).mockImplementation(() => { throw new DOMException("Blocked", "SecurityError"); });
  vi.spyOn(console, "warn").mockImplementation(() => {});
  const { getOrCreateResponseBrowserId } = await import("./responseBrowserId");
  const first = getOrCreateResponseBrowserId();
  expect(first).toMatch(/^[0-9a-f-]{36}$/);
  expect(getOrCreateResponseBrowserId()).toBe(first);
  expect(getOrCreateResponseBrowserId()).toBe(first);
});
