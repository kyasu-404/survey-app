import { describe, expect, it } from "vitest";
import { getSignatureImage } from "./signatureImage";
import { TEST_SIGNATURE_PNG } from "../../test/signatures";

const svgUrl = (body: string) => `data:image/svg+xml;base64,${btoa(body)}`;

describe("signature images", () => {
  it("recognizes embedded PNG dimensions without changing the stored value", () => {
    expect(getSignatureImage(TEST_SIGNATURE_PNG)).toEqual({ dataUrl: TEST_SIGNATURE_PNG, extension: "png", width: 1, height: 1 });
  });

  it("accepts the geometry and namespace attributes emitted by SignaturePad", () => {
    const source = '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="300" height="200" viewBox="0 0 300 200"><path d="M 1,2 C 10,20 40,50 100,120" stroke="black" stroke-width="2.25" fill="none" stroke-linecap="round"/></svg>';
    expect(getSignatureImage(svgUrl(source))).toMatchObject({ extension: "svg", width: 300, height: 200 });
  });

  it.each([
    "", "data:image/png;base64,notAnImage", "data:image/png;base64,%%%", "https://example.test/sign.png",
    'data:image/png;base64,abc" onerror="alert(1)', "data:text/html;base64,PHNjcmlwdD4=",
    svgUrl('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="200"><script>alert(1)</script></svg>'),
    svgUrl('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="200"><path fill="url(https://example.test/x)"/></svg>'),
    svgUrl('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="200" onload="alert(1)"/>'),
    svgUrl('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="200"><image href="https://example.test/x"/></svg>'),
    svgUrl('<svg xmlns="http://www.w3.org/2000/svg" width="999999" height="200"/>'),
    svgUrl('<!DOCTYPE svg [<!ENTITY a "x">]><svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>'),
  ])("rejects invalid or active image input %#", value => {
    expect(getSignatureImage(value)).toBeNull();
  });
});
