import { afterEach, describe, expect, it, vi } from "vitest";
import { createQrPngDataUrl, createQrSvg, downloadDataUrl, svgToDataUrl } from "./qrCode";

const { toDataURL, toString } = vi.hoisted(() => ({
  toDataURL: vi.fn(),
  toString: vi.fn(),
}));

vi.mock("qrcode", () => ({
  default: {
    toDataURL,
    toString,
  },
  toDataURL,
  toString,
}));

describe("qrCode helpers", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    toDataURL.mockReset();
    toString.mockReset();
  });

  it("creates SVG QR codes with the app defaults", async () => {
    toString.mockResolvedValue("<svg />");

    await expect(createQrSvg("https://example.test/form")).resolves.toBe("<svg />");
    expect(toString).toHaveBeenCalledWith(
      "https://example.test/form",
      expect.objectContaining({
        type: "svg",
        width: 512,
      }),
    );
  });

  it("creates PNG data URLs with the same QR defaults", async () => {
    toDataURL.mockResolvedValue("data:image/png;base64,abc");

    await expect(createQrPngDataUrl("https://example.test/form")).resolves.toBe("data:image/png;base64,abc");
    expect(toDataURL).toHaveBeenCalledWith(
      "https://example.test/form",
      expect.objectContaining({
        type: "image/png",
        width: 512,
      }),
    );
  });

  it("encodes inline SVG markup into a data URL", () => {
    expect(svgToDataUrl("<svg>Привет</svg>")).toBe(
      "data:image/svg+xml;charset=utf-8,%3Csvg%3E%D0%9F%D1%80%D0%B8%D0%B2%D0%B5%D1%82%3C%2Fsvg%3E",
    );
  });

  it("downloads a data URL through a temporary anchor element", () => {
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);

    downloadDataUrl("data:image/svg+xml;base64,abc", "form-qr.svg");

    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(document.querySelector("a")).toBeNull();
  });
});
