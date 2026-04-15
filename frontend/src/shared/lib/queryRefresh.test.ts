import type { QueryClient } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { scheduleDebouncedQueryInvalidation, scheduleQueryInvalidation } from "./queryRefresh";

describe("query refresh helpers", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("invalidates each target query immediately", async () => {
    const invalidateQueries = vi.fn().mockResolvedValue(undefined);
    const queryClient = {
      invalidateQueries,
    } as unknown as QueryClient;

    scheduleQueryInvalidation(queryClient, "manual refresh", [
      { queryKey: ["forms"] },
      { queryKey: ["users"] },
    ]);

    await Promise.resolve();
    await Promise.resolve();

    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ["forms"] });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ["users"] });
  });

  it("debounces repeated invalidations for the same target set", async () => {
    vi.useFakeTimers();

    const invalidateQueries = vi.fn().mockResolvedValue(undefined);
    const clearTimeoutSpy = vi.spyOn(globalThis, "clearTimeout");
    const queryClient = {
      invalidateQueries,
    } as unknown as QueryClient;

    scheduleDebouncedQueryInvalidation(queryClient, "auth change", [{ queryKey: ["forms"] }], 300);
    scheduleDebouncedQueryInvalidation(queryClient, "auth change", [{ queryKey: ["forms"] }], 300);

    expect(clearTimeoutSpy).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(299);
    expect(invalidateQueries).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    await Promise.resolve();
    await Promise.resolve();

    expect(invalidateQueries).toHaveBeenCalledTimes(1);
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ["forms"] });
  });
});
