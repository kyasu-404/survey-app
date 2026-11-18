import { afterEach, describe, expect, it, vi } from "vitest";
import { officeRequest } from "../../office/api";
import { exportResponseFilesZip } from "./responseFilesZip";

vi.mock("../../office/api", () => ({ officeRequest: vi.fn() }));

describe("native ZIP download", () => {
  afterEach(() => vi.restoreAllMocks());

  it("starts a same-origin download using the issued ticket", async () => {
    const selected = [{ id: "answer", number: 101 }];
    vi.mocked(officeRequest).mockResolvedValueOnce({ ticket: "ticket" });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      expect(this.pathname).toBe("/api/office/response-archives/ticket");
      expect(this.hasAttribute("download")).toBe(true);
    });
    expect(await exportResponseFilesZip("form", selected, new AbortController().signal)).toBe(true);
    expect(officeRequest).toHaveBeenLastCalledWith("/forms/form/response-archive", {
      method: "POST", body: JSON.stringify({ selected }), signal: expect.any(AbortSignal),
    });
    expect(click).toHaveBeenCalledOnce();
  });

  it("does not open a download for no files or after leaving the page during preparation", async () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    const controller = new AbortController();
    vi.mocked(officeRequest).mockResolvedValueOnce({ ticket: null });
    expect(await exportResponseFilesZip("form", undefined, controller.signal)).toBe(false);
    vi.mocked(officeRequest).mockImplementationOnce(async () => {
      controller.abort();
      return { ticket: "ticket" };
    });
    await expect(exportResponseFilesZip("form", undefined, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(click).not.toHaveBeenCalled();
  });
});
