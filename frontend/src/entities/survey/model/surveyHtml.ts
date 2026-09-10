import DOMPurify from "dompurify";
import { prepareSurveyHtmlStyles } from "./surveyHtmlStyles";
import { MAX_SURVEY_SCHEMA_BYTES } from "./surveySchemaSecurity";

const SAFE_HTML_TAGS = [
  "p", "br", "strong", "b", "em", "i", "u", "s", "ul", "ol", "li",
  "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "code", "pre",
  "span", "div", "table", "thead", "tbody", "tr", "th", "td",
];

let htmlScopeSequence = 0;
const htmlCache = new Map<string, string>();

export function sanitizeSurveyHtml(html: string): string {
  const cached = htmlCache.get(html);
  if (cached !== undefined) return cached;
  const fragment = DOMPurify.sanitize(html, {
    ALLOWED_TAGS: [...SAFE_HTML_TAGS, "style"],
    ALLOWED_ATTR: ["class", "id", "style", "title", "aria-label", "colspan", "rowspan"],
    ALLOW_DATA_ATTR: false,
    ALLOW_ARIA_ATTR: true,
    RETURN_DOM_FRAGMENT: true,
    FORCE_BODY: true,
  });
  const sourceStyles = Array.from(fragment.querySelectorAll("style"), element => {
    const css = element.textContent ?? "";
    element.remove();
    return css;
  });
  const scope = `survey-html-${++htmlScopeSequence}`;
  const ids = new Map<string, string>();
  fragment.querySelectorAll("[id]").forEach(element => {
    const name = element.id;
    if (!ids.has(name)) ids.set(name, `${scope}-id-${ids.size}`);
    element.id = ids.get(name)!;
  });
  const styles = prepareSurveyHtmlStyles(sourceStyles, scope, ids);
  fragment.querySelectorAll<HTMLElement>("[style]").forEach(element => {
    const css = styles.inline(element.getAttribute("style") ?? "");
    if (css) element.setAttribute("style", css);
    else element.removeAttribute("style");
  });
  if (styles.css) fragment.querySelectorAll("*").forEach(element => element.setAttribute("data-survey-html-scope", scope));
  const container = document.createElement("div");
  container.append(fragment);
  const result = container.innerHTML + (styles.css ? `<style>${styles.css}</style>` : "");
  // Keep rerenders/SurveyJS's repeated HTML processing stable without unbounded retention.
  if (htmlCache.size >= 100) htmlCache.clear();
  if (html.length <= MAX_SURVEY_SCHEMA_BYTES) {
    htmlCache.set(html, result);
    htmlCache.set(result, result);
  }
  return result;
}

