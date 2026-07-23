import { afterEach, describe, expect, it, vi } from "vitest";
import { copyTextToClipboard } from "./browser";

describe("browser helpers", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("uses the Clipboard API when it is available", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);

    Object.defineProperty(window.navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    await expect(copyTextToClipboard("https://example.test")).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith("https://example.test");
  });

  it("falls back to execCommand copy when the Clipboard API is unavailable", async () => {
    Object.defineProperty(window.navigator, "clipboard", {
      configurable: true,
      value: undefined,
    });

    const execCommand = vi.fn(() => true);
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      value: execCommand,
    });

    await expect(copyTextToClipboard("backup text")).resolves.toBe(true);
    expect(execCommand).toHaveBeenCalledWith("copy");
    expect(document.querySelector("textarea")).toBeNull();
  });
});
