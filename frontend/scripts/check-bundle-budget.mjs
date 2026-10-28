import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const distDir = fileURLToPath(new URL("../dist", import.meta.url));

const budgets = {
  initial: { raw: 850_000, gzip: 230_000 },
  mainJs: { raw: 4_200_000, gzip: 950_000 },
  asyncJs: { raw: 1_000_000, gzip: 320_000 },
  lazySurveyCoreJs: { raw: 1_700_000, gzip: 320_000 },
  lazySurveyCreatorCoreJs: { raw: 1_650_000, gzip: 400_000 },
  css: { raw: 550_000, gzip: 125_000 },
  image: { raw: 250_000 },
  font: { raw: 32_768 },
  textFont: { raw: 49_152 },
  // Patched React Router 7, durable-job UI and motion add about 36 KiB.
  // Responsive navigation, styles and editor controls add another 14 KiB.
  // Viewport-bounded menus and mobile preview refinements add 2.5 KiB.
  // Answer formatting and draft upload restoration add a measured 6.4 KiB.
  // Standalone section hierarchy and preview chrome add another 1.5 KiB.
  // Sharing tabs, iframe code and collapsible filters add about 8 KiB.
  // Allocate 10 KiB for this UI; dependency and initial-load budgets stay fixed.
  // Keep the initial-load gate unchanged; allow only this measured increase.
  // Personal links, invitation status and response binding add 9.8 KiB.
  // Reserve 12 KiB; initial-load and dependency budgets remain unchanged.
  // Lazy mail composer, recipient selection and responsive layout add 15.2 KiB.
  // Reserve 18 KiB; initial-load and dependency limits stay fixed.
  // iframe settings and favicon UI add a measured 12 KiB; reserve 14 KiB.
  // Initial-load and dependency limits stay fixed.
  // Navigation rail, user creation dialog and full-height response sheet add
  // 9.2 KiB measured. Reserve 10 KiB; startup/dependency limits stay fixed.
  // Local Material Symbols subset + Apache license add 15.1 KiB net after
  // replacing duplicated icon assets. Reserve 16 KiB; startup limits stay fixed.
  // Self-hosted variable Roboto (8 Unicode/style subsets), SIL license and UI
  // changes add 281.0 KiB measured. Reserve 288 KiB; JS/CSS startup, dependency
  // and icon-font limits stay fixed. Each text subset is capped at 48 KiB.
  // Lazy public/private routes add 12.3 KiB of shared chunks and manifest entries.
  // Reserve 16 KiB; startup and dependency limits remain unchanged.
  total: { raw: 7_373_716 },
};

function formatBytes(bytes) {
  return `${(bytes / 1024).toFixed(1)} KiB`;
}

function listFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = join(directory, entry.name);

    if (entry.isDirectory()) {
      return listFiles(entryPath);
    }

    return entryPath;
  });
}

function getBudget(filePath) {
  const name = basename(filePath);
  const extension = extname(filePath);

  if (extension === ".js") {
    if (name.startsWith("survey-core-")) {
      return budgets.lazySurveyCoreJs;
    }

    if (name.startsWith("survey-creator-core-")) {
      return budgets.lazySurveyCreatorCoreJs;
    }

    return name.startsWith("index-") ? budgets.mainJs : budgets.asyncJs;
  }

  if (extension === ".css") {
    return budgets.css;
  }

  if ([".avif", ".gif", ".jpg", ".jpeg", ".png", ".svg", ".webp"].includes(extension)) {
    return budgets.image;
  }

  if (extension === ".woff2") return name.startsWith("roboto-") ? budgets.textFont : budgets.font;

  return undefined;
}

if (!existsSync(distDir)) {
  console.error("dist/ does not exist. Run npm run build before checking the bundle budget.");
  process.exit(1);
}

const failures = [];
// Checking individual files misses regressions where a lazy feature becomes an
// entry dependency. Gate the entire static import tree, including its styles.
const manifest = JSON.parse(readFileSync(join(distDir, ".vite/manifest.json"), "utf8"));
const initialFiles = new Set();
const visited = new Set();
function visitEntry(key) {
  if (visited.has(key)) return;
  visited.add(key);
  const chunk = manifest[key];
  initialFiles.add(chunk.file);
  for (const css of chunk.css ?? []) initialFiles.add(css);
  for (const dependency of chunk.imports ?? []) visitEntry(dependency);
}
for (const [key, chunk] of Object.entries(manifest)) {
  if (chunk.isEntry) visitEntry(key);
}
// Route-level guards catch heavy imports even when the entry remains lazy.
for (const [entry, forbidden] of [
  ["src/pages/TemplatesPage/TemplatesPage.tsx", /survey-(?:core|creator|react)|SurveyFormRenderer/],
  ["src/pages/SurveyPage/SurveyPage.tsx", /DashboardPage|LoginPage|AppLayout/],
]) {
  const visitedRoute = new Set();
  function visitRoute(key) {
    if (visitedRoute.has(key)) return;
    visitedRoute.add(key);
    const chunk = manifest[key];
    if (forbidden.test(chunk.file)) failures.push(`Unexpected static dependency of ${entry}: ${chunk.file}`);
    for (const dependency of chunk.imports ?? []) visitRoute(dependency);
  }
  if (!manifest[entry]) failures.push(`Missing route chunk: ${entry}`);
  else visitRoute(entry);
}
let initialRaw = 0;
let initialGzip = 0;
for (const name of initialFiles) {
  const data = readFileSync(join(distDir, name));
  initialRaw += data.byteLength;
  initialGzip += gzipSync(data).byteLength;
  if (/survey-(?:core|creator|react)|exceljs|sentry/i.test(name)) {
    failures.push(`Lazy feature unexpectedly loaded at startup: ${name}`);
  }
}
if (initialRaw > budgets.initial.raw || initialGzip > budgets.initial.gzip) {
  failures.push(`Initial JS/CSS ${formatBytes(initialRaw)} raw / ${formatBytes(initialGzip)} gzip exceeds budget`);
}
const files = listFiles(distDir);
let totalBytes = 0;

for (const filePath of files) {
  const rawBytes = statSync(filePath).size;
  const budget = getBudget(filePath);
  totalBytes += rawBytes;

  if (!budget) {
    continue;
  }

  if (rawBytes > budget.raw) {
    failures.push(`${basename(filePath)} raw size ${formatBytes(rawBytes)} exceeds ${formatBytes(budget.raw)}`);
  }

  if (budget.gzip) {
    const gzipBytes = gzipSync(readFileSync(filePath)).byteLength;

    if (gzipBytes > budget.gzip) {
      failures.push(`${basename(filePath)} gzip size ${formatBytes(gzipBytes)} exceeds ${formatBytes(budget.gzip)}`);
    }
  }
}

if (totalBytes > budgets.total.raw) {
  failures.push(`dist total ${formatBytes(totalBytes)} exceeds ${formatBytes(budgets.total.raw)}`);
}

if (failures.length > 0) {
  console.error("Bundle budget failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log(`Bundle budget passed: ${files.length} files, ${formatBytes(totalBytes)} total.`);
console.log(`Initial JS/CSS: ${initialFiles.size} files, ${formatBytes(initialRaw)} raw, ${formatBytes(initialGzip)} gzip.`);
