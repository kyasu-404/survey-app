import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = new URL("../", import.meta.url);
const fontDir = new URL("src/assets/fonts/", root);
const mapPath = new URL("src/shared/ui/materialSymbols.json", root);
const fontPath = new URL("material-symbols-outlined.woff2", fontDir);
const metadataPath = new URL("material-symbols-outlined.source.json", fontDir);
const licensePath = new URL("public/licenses/MaterialSymbols-LICENSE.txt", root);
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
const symbols = JSON.parse(await readFile(mapPath, "utf8"));
const names = Object.keys(symbols).sort();

if (process.argv.includes("--check")) {
  const metadata = JSON.parse(await readFile(metadataPath, "utf8"));
  const bytes = await readFile(fontPath);
  if (sha256(bytes) !== metadata.sha256 || bytes.subarray(0, 4).toString() !== "wOF2") throw new Error("Local icon font integrity check failed");
  if (JSON.stringify(symbols) !== JSON.stringify(metadata.codepoints)) throw new Error("Icon names/codepoints differ from the downloaded subset; run npm run icons:update");
  if (!(await readFile(licensePath, "utf8")).includes("Apache License")) throw new Error("Bundled icon license is missing");
  console.log(`Material Symbols verified: ${names.length} icons, ${bytes.length} bytes, local WOFF2.`);
  process.exit(0);
}

// Use Google's API directly rather than installing an unofficial npm wrapper.
// The pinned official repository supplies the codepoint index and Apache license.
const repositoryCommit = "10ecc14790612ca8fd164e3f4ffe9c16fc50d5b7";
const upstream = `https://raw.githubusercontent.com/google/material-design-icons/${repositoryCommit}/`;
const family = "Material Symbols Outlined:opsz,wght,FILL@20..24,400..500,0..1";
const cssUrl = new URL("https://fonts.googleapis.com/css2");
cssUrl.search = new URLSearchParams({ family, icon_names: names.join(","), display: "block" }).toString();
const userAgent = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

async function fetchOfficial(input) {
  const url = new URL(input);
  if (url.protocol !== "https:" || !["fonts.googleapis.com", "fonts.gstatic.com", "raw.githubusercontent.com"].includes(url.hostname)) throw new Error(`Unexpected font source: ${url}`);
  const response = await fetch(url, { redirect: "error", headers: { "User-Agent": userAgent }, signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`${url.hostname}: HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > 300_000) throw new Error("Unexpectedly large icon asset; keep the font subset small");
  return bytes;
}

const [cssBytes, codepointBytes, license] = await Promise.all([
  fetchOfficial(cssUrl),
  fetchOfficial(`${upstream}variablefont/MaterialSymbolsOutlined%5BFILL,GRAD,opsz,wght%5D.codepoints`),
  fetchOfficial(`${upstream}LICENSE`),
]);
const fontUrl = cssBytes.toString().match(/src:\s*url\((https:\/\/fonts\.gstatic\.com\/[^)]+)\)\s*format\('woff2'\)/)?.[1];
if (!fontUrl || !cssBytes.toString().includes("font-weight: 400 500")) throw new Error("Google Fonts did not return the expected variable WOFF2 font");
const font = await fetchOfficial(fontUrl);
if (font.subarray(0, 4).toString() !== "wOF2") throw new Error("Response is not a WOFF2 font");
const index = new Map(codepointBytes.toString().trim().split(/\r?\n/).map(line => line.split(/\s+/)));
const codepoints = Object.fromEntries(names.map(name => {
  const codepoint = index.get(name);
  if (!codepoint || !/^[a-f0-9]{4,6}$/.test(codepoint)) throw new Error(`Unknown official Material Symbol: ${name}`);
  return [name, codepoint];
}));
await mkdir(fontDir, { recursive: true });
await writeFile(fontPath, font);
await mkdir(new URL("public/licenses/", root), { recursive: true });
await writeFile(licensePath, license);
await writeFile(mapPath, `${JSON.stringify(codepoints, null, 2)}\n`);
await writeFile(metadataPath, `${JSON.stringify({
  family: "Material Symbols Outlined", axes: { FILL: [0, 1], wght: [400, 500], GRAD: 0, opsz: [20, 24] },
  repositoryCommit, cssUrl: cssUrl.href, fontUrl, sha256: sha256(font), bytes: font.length,
  codepointIndexSha256: sha256(codepointBytes), codepoints,
}, null, 2)}\n`);
console.log(`Saved ${names.length} official symbols (${font.length} bytes) to ${fileURLToPath(fontPath)}`);
