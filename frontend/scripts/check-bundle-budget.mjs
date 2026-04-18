import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { gzipSync } from "node:zlib";

const distDir = new URL("../dist", import.meta.url);

const budgets = {
  mainJs: { raw: 4_200_000, gzip: 950_000 },
  asyncJs: { raw: 1_000_000, gzip: 320_000 },
  css: { raw: 550_000, gzip: 125_000 },
  image: { raw: 250_000 },
  total: { raw: 6_700_000 },
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
    return name.startsWith("index-") ? budgets.mainJs : budgets.asyncJs;
  }

  if (extension === ".css") {
    return budgets.css;
  }

  if ([".avif", ".gif", ".jpg", ".jpeg", ".png", ".svg", ".webp"].includes(extension)) {
    return budgets.image;
  }

  return undefined;
}

if (!existsSync(distDir)) {
  console.error("dist/ does not exist. Run npm run build before checking the bundle budget.");
  process.exit(1);
}

const failures = [];
const files = listFiles(distDir.pathname);
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
