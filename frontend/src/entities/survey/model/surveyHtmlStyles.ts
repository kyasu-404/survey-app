import { generate, parse, walk, type CssNode, type Declaration } from "css-tree";

// Only presentation properties: no external resources, positioning over the app,
// custom properties that could feed URLs, or changes to browser interaction.
const PROPERTIES = new Set(`
  color background background-color background-image background-size background-position
  background-repeat background-origin background-clip -webkit-background-clip
  -webkit-text-fill-color -webkit-text-stroke -webkit-text-stroke-color -webkit-text-stroke-width
  font font-family font-size font-weight font-style font-variant line-height letter-spacing word-spacing
  text-align text-decoration text-decoration-color text-decoration-line text-decoration-style
  text-transform text-indent text-shadow text-overflow white-space overflow-wrap word-break
  vertical-align display box-sizing width min-width max-width height min-height max-height
  margin margin-top margin-right margin-bottom margin-left margin-inline margin-block
  padding padding-top padding-right padding-bottom padding-left padding-inline padding-block
  border border-width border-style border-color border-top border-right border-bottom border-left
  border-top-width border-right-width border-bottom-width border-left-width
  border-top-style border-right-style border-bottom-style border-left-style
  border-top-color border-right-color border-bottom-color border-left-color
  border-radius border-top-left-radius border-top-right-radius border-bottom-left-radius border-bottom-right-radius
  border-collapse border-spacing table-layout caption-side box-shadow opacity filter
  list-style-type list-style-position flex flex-grow flex-shrink flex-basis flex-direction flex-wrap
  align-items align-self align-content justify-content justify-items justify-self gap row-gap column-gap
  grid-template-columns grid-template-rows grid-column grid-row
  transform transform-origin animation animation-name animation-duration animation-delay
  animation-timing-function animation-iteration-count animation-direction animation-fill-mode animation-play-state
`.trim().split(/\s+/));

const FUNCTIONS = new Set(`
  rgb rgba hsl hsla hwb lab lch oklab oklch color color-mix light-dark
  linear-gradient radial-gradient conic-gradient repeating-linear-gradient repeating-radial-gradient repeating-conic-gradient
  calc min max clamp repeat minmax fit-content
  drop-shadow blur brightness contrast grayscale hue-rotate invert opacity saturate sepia
  translate translatex translatey translatez translate3d rotate rotatex rotatey rotatez rotate3d
  scale scalex scaley scalez scale3d skew skewx skewy matrix matrix3d perspective cubic-bezier steps linear
`.trim().split(/\s+/));

const ANIMATION_KEYWORDS = new Set(`
  none initial inherit unset revert revert-layer linear ease ease-in ease-out ease-in-out step-start step-end
  infinite normal reverse alternate alternate-reverse forwards backwards both running paused
`.trim().split(/\s+/));
const MAX_CSS_LENGTH = 64 * 1024;
const MAX_CSS_NODES = 10_000;

function parseCss(source: string, context: "stylesheet" | "declarationList") {
  if (source.length > MAX_CSS_LENGTH) return null;
  try {
    const ast = parse(source, { context });
    let nodes = 0;
    walk(ast, () => { if (++nodes > MAX_CSS_NODES) throw new Error("CSS is too complex"); });
    return ast;
  } catch {
    return null;
  }
}

function sanitizeDeclaration(node: Declaration, animations: Map<string, string>) {
  const property = node.property.toLowerCase();
  if (!PROPERTIES.has(property)) return "";
  let safe = true;
  walk(node.value, (value) => {
    if (value.type === "Url" || value.type === "Raw") safe = false;
    if (value.type === "Function" && !FUNCTIONS.has(value.name.toLowerCase())) safe = false;
    if (value.type === "String" && /[<>\\]/.test(value.value)) safe = false;
  });
  if (!safe) return "";

  // Never refer to the host application's keyframes, including via animation shorthand.
  if ((property === "animation" || property === "animation-name") && node.value.type === "Value") {
    node.value.children.forEach(value => {
      if (value.type === "Identifier") {
        const isKeyword = property === "animation-name"
          ? /^(none|initial|inherit|unset|revert|revert-layer)$/i.test(value.name)
          : ANIMATION_KEYWORDS.has(value.name.toLowerCase());
        if (!isKeyword) value.name = animations.get(value.name) ?? "none";
      }
      if (value.type === "String") value.value = animations.get(value.value) ?? "none";
    });
  }
  return generate(node);
}

function declarations(block: CssNode, animations: Map<string, string>) {
  if (block.type !== "Block" && block.type !== "DeclarationList") return "";
  return block.children.toArray()
    .filter((node): node is Declaration => node.type === "Declaration")
    .map(node => sanitizeDeclaration(node, animations)).filter(Boolean).join(";");
}

export function prepareSurveyHtmlStyles(styles: string[], scope: string, ids: Map<string, string>) {
  const sheets = styles.map(style => parseCss(style, "stylesheet"));
  const animations = new Map<string, string>();
  for (const sheet of sheets) {
    if (sheet?.type !== "StyleSheet") continue;
    sheet.children.forEach(node => {
      if (node.type !== "Atrule" || !/^(?:-webkit-)?keyframes$/i.test(node.name) || !node.prelude) return;
      const name = generate(node.prelude);
      if (/^[a-z_][\w-]*$/i.test(name)) animations.set(name, `${scope}-animation-${animations.size}`);
    });
  }

  const css: string[] = [];
  for (const sheet of sheets) {
    if (sheet?.type !== "StyleSheet") continue;
    sheet.children.forEach(node => {
      if (node.type === "Rule" && node.prelude.type === "SelectorList") {
        const selectors: string[] = [];
        node.prelude.children.forEach(selector => {
          let safe = true;
          walk(selector, child => {
            if (child.type === "Raw" || child.type === "NestingSelector" || child.type === "PseudoElementSelector") safe = false;
            if (child.type === "IdSelector") child.name = ids.get(child.name) ?? `${scope}-missing-id`;
          });
          if (safe) selectors.push(`:is(${generate(selector)})[data-survey-html-scope="${scope}"]`);
        });
        const body = declarations(node.block, animations);
        if (selectors.length && body) css.push(`${selectors.join(",")}{${body}}`);
      }
      if (node.type === "Atrule" && /^(?:-webkit-)?keyframes$/i.test(node.name) && node.prelude && node.block) {
        const name = animations.get(generate(node.prelude));
        if (!name) return;
        const frames: string[] = [];
        node.block.children.forEach(frame => {
          if (frame.type !== "Rule") return;
          const selector = generate(frame.prelude);
          if (!/^(?:(?:from|to|\d+(?:\.\d+)?%)(?:,|$))+$/i.test(selector)) return;
          const body = declarations(frame.block, animations);
          if (body) frames.push(`${selector}{${body}}`);
        });
        if (frames.length) css.push(`@keyframes ${name}{${frames.join("")}}`);
      }
    });
  }
  return {
    css: css.join("").replace(/</g, "\\3c "),
    inline: (source: string) => {
      const ast = parseCss(source, "declarationList");
      return ast ? declarations(ast, animations) : "";
    },
  };
}
