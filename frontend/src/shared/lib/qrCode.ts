import type { QRCodeToDataURLOptions, QRCodeToStringOptions } from "qrcode";

const QR_CODE_BASE_OPTIONS = {
  errorCorrectionLevel: "M" as const,
  margin: 2,
  width: 512,
  color: {
    dark: "#111111ff",
    light: "#00000000",
  },
};

const QR_CODE_SVG_OPTIONS: QRCodeToStringOptions = {
  ...QR_CODE_BASE_OPTIONS,
  type: "svg",
};

const QR_CODE_PNG_OPTIONS: QRCodeToDataURLOptions = {
  ...QR_CODE_BASE_OPTIONS,
  type: "image/png",
};

export async function createQrSvg(value: string) {
  const QRCode = await import("qrcode");
  return QRCode.toString(value, QR_CODE_SVG_OPTIONS);
}

export async function createQrPngDataUrl(value: string) {
  const QRCode = await import("qrcode");
  return QRCode.toDataURL(value, QR_CODE_PNG_OPTIONS);
}

export function svgToDataUrl(svg: string) {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export function downloadDataUrl(dataUrl: string, fileName: string) {
  if (typeof document === "undefined") {
    return;
  }

  const link = document.createElement("a");
  link.href = dataUrl;
  link.download = fileName;
  link.rel = "noopener";

  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}
