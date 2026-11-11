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
  // Lazy routes, shared RPC/realtime clients and upload metadata total ~7.37 MB.
  // Reserve ~1% for VITE_* values and build-environment variation; keep the
  // startup, route-dependency and per-asset limits unchanged.
  total: { raw: 7_450_000 },
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
