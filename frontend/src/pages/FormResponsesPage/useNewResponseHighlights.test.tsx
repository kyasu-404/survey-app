import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useNewResponseHighlights } from "./useNewResponseHighlights";

const row = (id: string, date = "2026-09-22T10:00:00Z") => ({ id, form_id: "form", created_at: date, data: {} });
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

it("does not highlight initial data, but highlights arrivals for one second after they render", () => {
  const { result, rerender, unmount } = renderHook(({ rows, count }) => useNewResponseHighlights("form", 1, rows, count), { initialProps: { rows: [row("old")], count: 1 } });
  expect(result.current.size).toBe(0);
  rerender({ rows: [row("new"), row("old")], count: 2 });
  expect([...result.current]).toEqual(["new"]);
  act(() => vi.advanceTimersByTime(700));
  rerender({ rows: [row("next"), row("new"), row("old")], count: 3 });
  act(() => vi.advanceTimersByTime(300)); expect([...result.current]).toEqual(["next"]);
  unmount(); expect(vi.getTimerCount()).toBe(0);
});

it("does not treat pagination or deletion shifts as new answers", () => {
  const { result, rerender } = renderHook(({ page, rows, count }) => useNewResponseHighlights("form", page, rows, count), { initialProps: { page: 1, rows: [row("a")], count: 100 } });
  rerender({ page: 1, rows: [row("b")], count: 99 }); expect(result.current.size).toBe(0);
  rerender({ page: 2, rows: [row("c")], count: 100 }); expect(result.current.size).toBe(0);
  rerender({ page: 1, rows: [row("d")], count: 101 }); expect(result.current.size).toBe(0);
});

it("highlights the first answer to an empty form and clears on form navigation", () => {
  const { result, rerender } = renderHook(({ id, rows }) => useNewResponseHighlights(id, 1, rows, rows.length), { initialProps: { id: "form", rows: [] as ReturnType<typeof row>[] } });
  rerender({ id: "form", rows: [row("first")] }); expect(result.current.has("first")).toBe(true);
  rerender({ id: "other", rows: [row("first")] }); expect(result.current.size).toBe(0); expect(vi.getTimerCount()).toBe(0);
});
