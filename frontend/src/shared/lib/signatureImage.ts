export const SIGNATURE_UNAVAILABLE = "Не удалось отобразить подпись";
const MAX_DATA_URL_LENGTH = 3 * 1024 * 1024;

export type SignatureImage = {
  dataUrl: string;
  extension: "png" | "jpeg" | "svg";
  width: number;
  height: number;
};

function validSize(width: number, height: number) {
  return Number.isFinite(width) && Number.isFinite(height)
    && width > 0 && height > 0 && width <= 8192 && height <= 8192 && width * height <= 16_000_000;
}

// SignaturePad SVG consists of geometry only. Never insert arbitrary SVG markup
// or allow references, CSS, animation, foreignObject, scripts, or external resources.
function readSvg(bytes: string): SignatureImage | null {
  if (/<!DOCTYPE|<!ENTITY/i.test(bytes)) return null;
  const doc = new DOMParser().parseFromString(bytes, "image/svg+xml");
  const svg = doc.documentElement;
  if (svg.localName !== "svg" || doc.querySelector("parsererror")) return null;
  if (doc.createTreeWalker(svg, NodeFilter.SHOW_PROCESSING_INSTRUCTION).nextNode()) return null;
  const tags = new Set(["svg", "g", "path", "circle", "ellipse", "line", "polyline", "polygon", "rect"]);
  const attributes = new Set([
    "width", "height", "viewBox", "d", "points", "x", "y", "x1", "x2", "y1", "y2", "cx", "cy", "r", "rx", "ry",
    "fill", "fill-opacity", "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin", "stroke-opacity",
    "stroke-miterlimit", "stroke-dasharray", "stroke-dashoffset", "opacity", "transform", "preserveAspectRatio",
  ]);
  const elements = [svg, ...svg.querySelectorAll("*")];
  if (elements.length > 10_000) return null;
  for (const element of elements) {
    if (!tags.has(element.localName) || element.namespaceURI !== "http://www.w3.org/2000/svg") return null;
    for (const attribute of Array.from(element.attributes)) {
      if (attribute.name === "xmlns" && attribute.value === "http://www.w3.org/2000/svg") continue;
      if (attribute.name === "xmlns:xlink" && attribute.value === "http://www.w3.org/1999/xlink") continue;
      if (!attributes.has(attribute.name)) return null;
      if (attribute.name === "fill" || attribute.name === "stroke") {
        if (!/^(?:[a-z]+|#[\da-f]{3,8}|(?:rgb|rgba|hsl|hsla)\([\d.,%\s+-]+\))$/i.test(attribute.value)) return null;
      } else if (!/^[\da-z.,%\s()+-]*$/i.test(attribute.value)) return null;
    }
  }
  const viewBox = (svg.getAttribute("viewBox") ?? "").trim().split(/[\s,]+/).map(Number);
  const width = parseFloat(svg.getAttribute("width") ?? "") || viewBox[2];
  const height = parseFloat(svg.getAttribute("height") ?? "") || viewBox[3];
  if (!validSize(width, height)) return null;
  // Serialize only the validated root; discard XML processing instructions.
  return { dataUrl: `data:image/svg+xml;base64,${btoa(new XMLSerializer().serializeToString(svg))}`, extension: "svg", width, height };
}

export function getSignatureImage(value: unknown): SignatureImage | null {
  if (typeof value !== "string" || value.length > MAX_DATA_URL_LENGTH) return null;
  const match = /^data:image\/(png|jpeg|svg\+xml);base64,([a-z0-9+/]+={0,2})$/i.exec(value);
  if (!match) return null;
  try {
    const bytes = atob(match[2]);
    const format = match[1].toLowerCase();
    if (format === "svg+xml") return readSvg(bytes);
    const u16 = (offset: number) => bytes.charCodeAt(offset) * 256 + bytes.charCodeAt(offset + 1);
    const u32 = (offset: number) => u16(offset) * 65536 + u16(offset + 2);
    let width = 0;
    let height = 0;
    if (format === "png") {
      if (!bytes.startsWith("\x89PNG\r\n\x1a\n") || bytes.slice(12, 16) !== "IHDR" || bytes.slice(-8, -4) !== "IEND") return null;
      width = u32(16);
      height = u32(20);
    } else {
      if (!bytes.startsWith("\xff\xd8") || !bytes.endsWith("\xff\xd9")) return null;
      for (let offset = 2; offset + 8 < bytes.length;) {
        if (bytes.charCodeAt(offset) !== 255) return null;
        const marker = bytes.charCodeAt(offset + 1);
        if (marker === 255) { offset += 1; continue; }
        const length = u16(offset + 2);
        if (length < 2 || offset + length + 2 > bytes.length) return null;
        if ([0xc0, 0xc1, 0xc2].includes(marker)) {
          height = u16(offset + 5);
          width = u16(offset + 7);
          break;
        }
        offset += length + 2;
      }
    }
    return validSize(width, height)
      ? { dataUrl: `data:image/${format};base64,${match[2]}`, extension: format as "png" | "jpeg", width, height }
      : null;
  } catch {
    return null;
  }
}

export async function getExcelSignatureImage(image: SignatureImage): Promise<SignatureImage | null> {
  if (image.extension !== "svg") return image;
  // ExcelJS embeds raster images. Render validated SVG locally, without a server
  // upload or a change to the stored response. Bound the raster's dimensions.
  const scale = Math.min(1, 1200 / image.width, 600 / image.height);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.width * scale));
  canvas.height = Math.max(1, Math.round(image.height * scale));
  return new Promise(resolve => {
    const element = new Image();
    const timer = setTimeout(() => { element.onload = null; element.onerror = null; resolve(null); }, 5000);
    const finish = (result: SignatureImage | null) => { clearTimeout(timer); resolve(result); };
    element.onerror = () => finish(null);
    element.onload = () => {
      try {
        const context = canvas.getContext("2d");
        if (!context) return finish(null);
        context.drawImage(element, 0, 0, canvas.width, canvas.height);
        finish({ dataUrl: canvas.toDataURL("image/png"), extension: "png", width: canvas.width, height: canvas.height });
      } catch { finish(null); }
    };
    element.src = image.dataUrl;
  });
}
