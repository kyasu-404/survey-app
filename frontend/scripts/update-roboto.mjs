import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const directory = new URL("src/assets/fonts/", root);
const manifestPath = new URL("roboto.source.json", directory);
const cssPath = new URL("roboto.css", directory);
const licensePath = new URL("public/licenses/Roboto-OFL.txt", root);
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const subsets = ["latin", "latin-ext", "cyrillic", "cyrillic-ext"];

if (process.argv.includes("--check")) {
  const metadata = JSON.parse(await readFile(manifestPath, "utf8"));
  if (metadata.files.length !== subsets.length * 2) throw new Error("Roboto subsets are missing");
  for (const file of metadata.files) {
    const font = await readFile(new URL(file.name, directory));
    if (font.subarray(0, 4).toString() !== "wOF2" || hash(font) !== file.sha256) throw new Error(`Roboto integrity check failed: ${file.name}`);
  }
  if (hash(await readFile(cssPath)) !== metadata.cssSha256) throw new Error("Roboto CSS differs from the downloaded subset metadata");
  if (!(await readFile(licensePath, "utf8")).includes("SIL OPEN FONT LICENSE")) throw new Error("Roboto license is missing");
  console.log(`Roboto verified: ${metadata.files.length} local WOFF2 subsets, normal/italic, weights 100–900.`);
  process.exit(0);
}

// Only this explicit maintenance command uses the network. Builds and browsers
// use the committed WOFF2 files; no Google Fonts stylesheet runs in the app.
const cssUrl = "https://fonts.googleapis.com/css2?family=Roboto:ital,wght@0,100..900;1,100..900&display=swap";
const licenseUrl = "https://raw.githubusercontent.com/google/fonts/main/ofl/roboto/OFL.txt";
async function official(url) {
  if (!/^https:\/\/(fonts\.googleapis\.com|fonts\.gstatic\.com|raw\.githubusercontent\.com)\//.test(url)) throw new Error(`Unexpected font source: ${url}`);
  const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(30_000), headers: {
    "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  } });
  if (!response.ok) throw new Error(`Font source HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}
const [remoteCss, license] = await Promise.all([official(cssUrl), official(licenseUrl)]);
const matches = [...remoteCss.toString().matchAll(/\/\* ([a-z-]+) \*\/\s*(@font-face\s*\{[^}]+\})/g)]
  .filter(match => subsets.includes(match[1]));
if (matches.length !== subsets.length * 2) throw new Error("Google Fonts returned unexpected Roboto subsets");
await mkdir(directory, { recursive: true });
const files = await Promise.all(matches.map(async ([, subset, rule]) => {
  const style = rule.match(/font-style:\s*(normal|italic)/)?.[1];
  const url = rule.match(/url\((https:\/\/fonts\.gstatic\.com\/[^)]+\.woff2)\)/)?.[1];
  if (!style || !url || !rule.includes("font-weight: 100 900")) throw new Error("Expected a variable Roboto WOFF2");
  const font = await official(url);
  if (font.subarray(0, 4).toString() !== "wOF2") throw new Error("Invalid WOFF2 font");
  const name = `roboto-${subset}-${style}.woff2`;
  await writeFile(new URL(name, directory), font);
  return { name, subset, style, url, bytes: font.length, sha256: hash(font), rule: rule.replace(url, `./${name}`) };
}));
const css = "/* Official Google Fonts Roboto. Vendored locally; see roboto.source.json and /licenses/Roboto-OFL.txt. */\n" + files.map(file => `/* ${file.subset} */\n${file.rule}\n`).join("\n");
await writeFile(cssPath, css);
await mkdir(new URL("public/licenses/", root), { recursive: true });
await writeFile(licensePath, license);
await writeFile(manifestPath, JSON.stringify({ family: "Roboto", cssUrl, licenseUrl, cssSha256: hash(css), files: files.map(file => ({
  name: file.name, subset: file.subset, style: file.style, url: file.url, bytes: file.bytes, sha256: file.sha256,
})) }, null, 2) + "\n");
console.log(`Saved ${files.length} Roboto files (${files.reduce((sum, file) => sum + file.bytes, 0)} bytes).`);
