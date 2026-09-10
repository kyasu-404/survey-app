import { sanitizeSurveyHtml } from "./surveyHtml";
import { describe, expect, it } from "vitest";
import type { SurveySchema } from "../types";
import { SUPABASE_URL } from "../../../shared/config/env";
import {
  MAX_SURVEY_SCHEMA_DEPTH,
  SurveySchemaSecurityError,
  isSafeSurveyNavigationUrl,
  sanitizeSurveySchema,
} from "./surveySchemaSecurity";

describe("survey schema security", () => {
  it("removes active URL properties at every level", () => {
    const result = sanitizeSurveySchema({
      navigateToUrl: "https://attacker.test/{answer}",
      pages: [{ elements: [{ type: "dropdown", name: "q", choicesByUrl: { url: "https://attacker.test" } }] }],
    } as unknown as SurveySchema);

    expect(JSON.stringify(result)).not.toContain("attacker.test");
    expect(result.pages).toHaveLength(1);
  });

  it("removes cross-origin media URLs while retaining local and embedded raster assets", () => {
    const managedLogoToken = "__APP_SURVEY_ASSET__/forms/11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222/33333333-3333-4333-8333-333333333333.png";
    const result = sanitizeSurveySchema({
      logo: managedLogoToken,
      backgroundImage: "//attacker.test/background.png",
      pages: [{
        elements: [
          { type: "image", name: "remote", imageLink: "https://attacker.test/tracker" },
          { type: "image", name: "local", imageLink: "/assets/local.png" },
          { type: "image", name: "embedded", imageLink: "data:image/png;base64,aGVsbG8=" },
          { type: "html", name: "video", contentMode: "youtube", videoLink: "https://attacker.test/video" },
        ],
      }],
    } as unknown as SurveySchema) as unknown as {
      logo?: string;
      backgroundImage?: string;
      pages: Array<{ elements: Array<Record<string, unknown>> }>;
    };

    expect(result.logo).toBe(managedLogoToken);
    expect(result.backgroundImage).toBeUndefined();
    expect(result.pages[0].elements[0].imageLink).toBeUndefined();
    expect(result.pages[0].elements[1].imageLink).toBe("/assets/local.png");
    expect(result.pages[0].elements[2].imageLink).toBe("data:image/png;base64,aGVsbG8=");
    expect(result.pages[0].elements[3].contentMode).toBeUndefined();
    expect(result.pages[0].elements[3].videoLink).toBeUndefined();
  });

  it("removes an arbitrary remote logo", () => {
    expect(sanitizeSurveySchema({
      logo: "https://attacker.test/logo.png",
      pages: [],
    })).toEqual({ pages: [] });
  });

  it("rejects excessive nesting", () => {
    const schema: Record<string, unknown> = {};
    let cursor = schema;
    for (let index = 0; index <= MAX_SURVEY_SCHEMA_DEPTH + 1; index += 1) {
      cursor.child = {};
      cursor = cursor.child as Record<string, unknown>;
    }

    expect(() => sanitizeSurveySchema(schema as SurveySchema)).toThrow(SurveySchemaSecurityError);
  });

  it("sanitizes executable and network-capable HTML", () => {
    const result = sanitizeSurveyHtml('<p onclick="alert(1)">OK</p><img src="https://attacker.test/x"><script>alert(1)</script>');
    expect(result).toBe("<p>OK</p>");
  });

  it("allows navigation only to the same HTTP origin", () => {
    expect(isSafeSurveyNavigationUrl("/done", "https://survey.test/form")).toBe(true);
    expect(isSafeSurveyNavigationUrl("https://attacker.test/done", "https://survey.test/form")).toBe(false);
    expect(isSafeSurveyNavigationUrl("javascript:alert(1)", "https://survey.test/form")).toBe(false);
  });

  it("preserves presentation styles and isolates selectors, IDs, and animation names", () => {
    const source = `<style>
      body, .sample, #heading { color: transparent; background: linear-gradient(90deg, cyan, magenta); background-clip: text;
        filter: drop-shadow(0 0 5px cyan); animation: floating 2s linear infinite; }
      @keyframes floating { 0%,100% { transform: translateY(0) } 50% { transform: translateY(-6px) } }
    </style><div id="heading" class="sample" style="font-size:42px;font-weight:900;padding:18px 32px;border:1px solid red">Текст</div>`;
    const result = sanitizeSurveyHtml(source);
    const doc = new DOMParser().parseFromString(result, "text/html");
    const element = doc.querySelector(".sample")!;
    const scope = element.getAttribute("data-survey-html-scope")!;
    const css = doc.querySelector("style")!.textContent!;
    expect(element.getAttribute("style")).toContain("font-size:42px");
    expect(element.getAttribute("style")).toContain("padding:18px 32px");
    expect(element.id).toBe(`${scope}-id-0`);
    expect(css).toContain(`:is(body)[data-survey-html-scope="${scope}"]`);
    expect(css).toContain(`:is(#${scope}-id-0)[data-survey-html-scope="${scope}"]`);
    expect(css).toContain("background:linear-gradient(90deg,cyan,magenta)");
    expect(css).toContain("filter:drop-shadow(0 0 5px cyan)");
    expect(css).toContain(`animation:${scope}-animation-0 2s linear infinite`);
    expect(css).toContain(`@keyframes ${scope}-animation-0{0%,100%{transform:translateY(0)}`);
    expect(sanitizeSurveyHtml(source)).toBe(result);
    expect(sanitizeSurveyHtml(result)).toBe(result);
    const other = sanitizeSurveyHtml(source.replace("Текст", "Другой текст"));
    expect(other).not.toContain(`data-survey-html-scope="${scope}"`);
  });

  it("removes network and executable CSS, global at-rules, and references to host animations", () => {
    const result = sanitizeSurveyHtml(String.raw`<style>
      @import 'https://attacker.test/a.css';
      @font-face {font-family: evil; src: url(https://attacker.test/font)}
      @property --evil {syntax:'*';inherits:true;initial-value:red}
      .safe {background-image:u\72l(https://attacker.test/image);color:red;position:fixed;z-index:99999;animation:hostAnimation 1s}
      body::before {content:'cover';color:red}
    </style><p class="safe" onclick="alert(1)" style="background:url(https://attacker.test/b);--evil:red;filter:url(#host);width:expression(alert(1));color:blue">OK</p>`);
    expect(result).not.toMatch(/attacker|@import|@font-face|@property|position:|z-index:|hostAnimation|::before|content:|onclick|expression\(|url\(/i);
    expect(result).toContain("color:red");
    expect(result).toContain('style="color:blue"');
    expect(result).toContain("animation:none 1s");
  });

  it("keeps HTML without custom CSS unchanged and tolerates malformed styles", () => {
    expect(sanitizeSurveyHtml("<p><strong>Важно</strong><br>Текст</p>")).toBe("<p><strong>Важно</strong><br>Текст</p>");
    const result = sanitizeSurveyHtml('<p style="bad:!!!;color:green">Текст</p><style>.x {color:}</style>');
    expect(result).toContain('style="color:green"');
    expect(result).not.toContain("bad:");
  });

  it("keeps timing function arguments and isolates animation names that also name timing keywords", () => {
    const result = sanitizeSurveyHtml(`<div class="animated">Текст</div><style>
      .animated {animation: bounce 2s steps(4,end) infinite;animation-name:linear}
      @keyframes bounce {to {opacity:0.5}}
      @keyframes linear {to {opacity:1}}
    </style>`);
    expect(result).toMatch(/animation:survey-html-\d+-animation-0 2s steps\(4,end\) infinite/);
    expect(result).toMatch(/animation-name:survey-html-\d+-animation-1/);
  });

  it("serializes image picker uploads before applying the external URL restriction", () => {
    const path = "forms/11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222/33333333-3333-4333-8333-333333333333.png";
    const url = `${SUPABASE_URL}/storage/v1/object/public/survey-assets/${path}`;
    const result = sanitizeSurveySchema({ pages: [{ elements: [{ type: "imagepicker", name: "pictures", choices: [
      { value: "a", text: "Первый", imageLink: url },
      { value: "b", text: "Второй", imageLink: "https://attacker.test/image.png" },
    ] }] }] } as SurveySchema);
    expect(result.pages[0].elements[0].choices).toEqual([
      { value: "a", text: "Первый", imageLink: `__APP_SURVEY_ASSET__/${path}` },
      { value: "b", text: "Второй" },
    ]);
  });
});
