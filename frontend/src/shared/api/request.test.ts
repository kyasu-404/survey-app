import { afterEach, describe, expect, it, vi } from "vitest";
import { RequestTimeoutError, runRequest } from "./request";

describe("runRequest", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("returns the request result and clears the timeout on success", async () => {
    const clearTimeoutSpy = vi.spyOn(globalThis, "clearTimeout");
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(
      runRequest("forms.load", () => Promise.resolve("ok"), {
        timeoutMs: 500,
        context: { formId: "form-1" },
      }),
    ).resolves.toBe("ok");

    expect(clearTimeoutSpy).toHaveBeenCalledTimes(1);
  });

  it("attaches correlation headers to Supabase request builders", async () => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const setHeader = vi.fn();
    const builder = {
      setHeader,
      then: <TResult1 = string, TResult2 = never>(
        onfulfilled?: ((value: string) => TResult1 | PromiseLike<TResult1>) | null,
      ) => {
        return Promise.resolve(onfulfilled ? onfulfilled("ok") : ("ok" as TResult1)) as PromiseLike<
          TResult1 | TResult2
        >;
      },
    } satisfies PromiseLike<string> & { setHeader: (name: string, value: string) => unknown };

    await expect(runRequest("forms.load", () => builder)).resolves.toBe("ok");

    expect(setHeader).toHaveBeenCalledWith("x-request-id", expect.stringMatching(/[0-9a-f-]{16,}/i));
    expect(setHeader).toHaveBeenCalledWith("traceparent", expect.stringMatching(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/));
    expect(setHeader).toHaveBeenCalledWith("x-client-release", expect.any(String));
  });

  it("rejects with a timeout error when the request hangs", async () => {
    vi.useFakeTimers();
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const requestPromise = runRequest(
      "forms.load",
      () =>
        new Promise<string>(() => {
          return undefined;
        }),
      { timeoutMs: 200 },
    );
    const handledPromise = requestPromise.catch((error) => error);

    await vi.advanceTimersByTimeAsync(200);

    const timeoutError = await handledPromise;

    expect(timeoutError).toBeInstanceOf(RequestTimeoutError);
    expect(timeoutError).toMatchObject({
      message: 'Запрос "forms.load" превысил таймаут 0 сек.',
    });
  });

  it("aborts the request signal when the local timeout fires", async () => {
    vi.useFakeTimers();
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const abortListener = vi.fn();

    const requestPromise = runRequest(
      "forms.load",
      (signal) =>
        new Promise<string>(() => {
          signal.addEventListener("abort", abortListener);
        }),
      { timeoutMs: 200 },
    ).catch((error) => error);

    await vi.advanceTimersByTimeAsync(200);

    await expect(requestPromise).resolves.toBeInstanceOf(RequestTimeoutError);
    expect(abortListener).toHaveBeenCalledTimes(1);
  });

  it("links an upstream abort signal to the request signal", async () => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const upstreamController = new AbortController();
    let requestSignal: AbortSignal | undefined;

    await runRequest(
      "forms.load",
      (signal) => {
        requestSignal = signal;
        upstreamController.abort();
        return "ok";
      },
      { signal: upstreamController.signal },
    );

    expect(requestSignal?.aborted).toBe(true);
  });

  it("rethrows regular request errors and still clears the timer", async () => {
    const clearTimeoutSpy = vi.spyOn(globalThis, "clearTimeout");
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(
      runRequest("forms.load", async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    expect(clearTimeoutSpy).toHaveBeenCalledTimes(1);
  });
});
