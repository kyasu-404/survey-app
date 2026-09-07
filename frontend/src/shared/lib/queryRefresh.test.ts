import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createQueryRefreshScheduler, scheduleQueryInvalidation } from "./queryRefresh";

const clients: QueryClient[] = [];
const cleanups: Array<() => void> = [];
function setup(debounceMs = 750) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  clients.push(client);
  const scheduler = createQueryRefreshScheduler(client, "realtime", debounceMs);
  cleanups.push(scheduler.dispose);
  return { client, scheduler };
}

function deferred<T>() {
  let resolve!: (data: T) => void;
  const promise = new Promise<T>((res) => { resolve = res; });
  return { promise, resolve };
}

describe("query refresh helpers", () => {
  afterEach(() => {
    cleanups.splice(0).forEach((dispose) => dispose());
    clients.splice(0).forEach((client) => client.clear());
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("invalidates each target query immediately", async () => {
    const { client } = setup();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    await scheduleQueryInvalidation(client, "manual", [{ queryKey: ["forms"] }, { queryKey: ["users"] }]);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["forms"] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["users"] });
  });

  it("coalesces a burst and preserves every affected target", async () => {
    vi.useFakeTimers();
    const { client, scheduler } = setup();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    scheduler.schedule([{ queryKey: ["forms"] }, { queryKey: ["stats"] }]);
    await vi.advanceTimersByTimeAsync(200);
    scheduler.schedule([{ queryKey: ["forms"] }]);
    await vi.advanceTimersByTimeAsync(749);
    expect(invalidate).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(invalidate).toHaveBeenCalledTimes(2);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["stats"], refetchType: "active" }, { cancelRefetch: false });
  });

  it("refreshes during a continuous stream instead of waiting forever for quiet", async () => {
    vi.useFakeTimers();
    const { client, scheduler } = setup();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    for (let index = 0; index < 6; index += 1) {
      scheduler.schedule([{ queryKey: ["forms"] }]);
      await vi.advanceTimersByTimeAsync(500);
    }
    expect(invalidate).toHaveBeenCalledTimes(3);
  });

  it("waits for an in-flight snapshot and then reads changes that arrived during it", async () => {
    vi.useFakeTimers();
    const { client, scheduler } = setup(100);
    const pending = deferred<string>();
    const queryFn = vi.fn().mockImplementationOnce(() => pending.promise).mockResolvedValue("new");
    const observer = new QueryObserver(client, { queryKey: ["forms"], queryFn });
    cleanups.push(observer.subscribe(() => {}));
    scheduler.schedule([{ queryKey: ["forms"] }]);
    await vi.advanceTimersByTimeAsync(100);
    expect(queryFn).toHaveBeenCalledOnce();
    pending.resolve("old");
    await vi.advanceTimersByTimeAsync(0);
    expect(queryFn).toHaveBeenCalledTimes(2);
    expect(client.getQueryData(["forms"])).toBe("new");
  });

  it("queues one more refresh for changes received during its own refetch", async () => {
    vi.useFakeTimers();
    const { client, scheduler } = setup(100);
    const pending = deferred<string>();
    const queryFn = vi.fn().mockResolvedValueOnce("initial").mockImplementationOnce(() => pending.promise).mockResolvedValue("latest");
    const observer = new QueryObserver(client, { queryKey: ["forms"], queryFn });
    cleanups.push(observer.subscribe(() => {}));
    await vi.advanceTimersByTimeAsync(0);
    scheduler.schedule([{ queryKey: ["forms"] }]);
    await vi.advanceTimersByTimeAsync(100);
    scheduler.schedule([{ queryKey: ["forms"] }]);
    scheduler.schedule([{ queryKey: ["forms"] }]);
    await vi.advanceTimersByTimeAsync(1000);
    expect(queryFn).toHaveBeenCalledTimes(2);
    pending.resolve("intermediate");
    await vi.advanceTimersByTimeAsync(1);
    expect(queryFn).toHaveBeenCalledTimes(3);
    expect(client.getQueryData(["forms"])).toBe("latest");
  });

  it("does not refresh after disposal or interfere with another client", async () => {
    vi.useFakeTimers();
    const first = setup();
    const second = setup();
    const firstInvalidate = vi.spyOn(first.client, "invalidateQueries");
    const secondInvalidate = vi.spyOn(second.client, "invalidateQueries");
    first.scheduler.schedule([{ queryKey: ["forms"] }]);
    second.scheduler.schedule([{ queryKey: ["forms"] }]);
    first.scheduler.dispose();
    await vi.advanceTimersByTimeAsync(1000);
    expect(firstInvalidate).not.toHaveBeenCalled();
    expect(secondInvalidate).toHaveBeenCalledOnce();
  });
});
