import { StrictMode, type ReactNode } from "react";
import { act, renderHook } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useNavigationListRefresh } from "./useNavigationListRefresh";

function wrapper({ children }: { children: ReactNode }) {
  return <StrictMode><MemoryRouter initialEntries={[{
    pathname: "/dashboard", search: "?page=1", hash: "#forms", state: { refreshList: true },
  }]}>{children}</MemoryRouter></StrictMode>;
}

describe("navigation list refresh", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("reloads once after navigation even when query state changes before the timer", () => {
    const reload = vi.fn();
    const { result, rerender } = renderHook(({ isFetching }) => {
      useNavigationListRefresh({ ready: true, isFetching, updatedAt: 100, reload });
      return useLocation();
    }, { wrapper, initialProps: { isFetching: false } });
    act(() => vi.advanceTimersByTime(10));
    rerender({ isFetching: true });
    act(() => vi.advanceTimersByTime(10));
    rerender({ isFetching: false });
    act(() => vi.advanceTimersByTime(5));
    expect(reload).toHaveBeenCalledTimes(1);
    expect(result.current.state).toBeNull();
    expect(result.current.search).toBe("?page=1");
    expect(result.current.hash).toBe("#forms");
    act(() => vi.advanceTimersByTime(100));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("consumes the flag without duplicating a completed refresh", () => {
    const reload = vi.fn();
    const { result, rerender } = renderHook(({ updatedAt }) => {
      useNavigationListRefresh({ ready: true, isFetching: false, updatedAt, reload });
      return useLocation();
    }, { wrapper, initialProps: { updatedAt: 100 } });
    rerender({ updatedAt: 200 });
    act(() => vi.advanceTimersByTime(25));
    expect(reload).not.toHaveBeenCalled();
    expect(result.current.state).toBeNull();
  });

  it("waits for authentication readiness and cancels work on unmount", () => {
    const reload = vi.fn();
    const { rerender, unmount } = renderHook(({ ready }) => {
      useNavigationListRefresh({ ready, isFetching: false, updatedAt: 0, reload });
    }, { wrapper, initialProps: { ready: false } });
    act(() => vi.advanceTimersByTime(100));
    expect(reload).not.toHaveBeenCalled();
    rerender({ ready: true });
    unmount();
    act(() => vi.advanceTimersByTime(100));
    expect(reload).not.toHaveBeenCalled();
  });
});
