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
