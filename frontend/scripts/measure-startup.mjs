/* global window, location */
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { resolve, extname, join } from "node:path";
import { gzipSync } from "node:zlib";
import { chromium } from "@playwright/test";

// Isolated local measurements; no authenticated session or production writes.
const directories = process.argv.slice(2);
if (!directories.length) directories.push("dist");
const browser = await chromium.launch();
const reports = [];
try {
  for (const directory of directories) {
    const root = resolve(directory);
    const server = createServer(async (req, res) => {
      try {
        let name = new URL(req.url, "http://localhost").pathname;
        if (!extname(name)) name = "/index.html";
        const path = resolve(root, `.${name}`);
        if (!path.startsWith(`${root}/`)) { res.writeHead(403).end(); return; }
        const data = await readFile(path);
        const metadata = await stat(path);
        const etag = `"${metadata.size}-${metadata.mtimeMs}"`;
        const type = { ".html": "text/html", ".js": "application/javascript", ".css": "text/css", ".png": "image/png", ".svg": "image/svg+xml" }[extname(path)] ?? "application/octet-stream";
        const immutable = /^\/assets\/.+-[A-Za-z0-9_-]{8,}\.[a-z0-9]+$/.test(name);
        res.setHeader("Cache-Control", immutable ? "public, max-age=31536000, immutable" : "no-cache");
        res.setHeader("ETag", etag);
        if (req.headers["if-none-match"] === etag) { res.writeHead(304).end(); return; }
        res.setHeader("Content-Type", type);
        if (/javascript|css|html/.test(type)) {
          const compressed = gzipSync(data);
          res.setHeader("Content-Encoding", "gzip");
          res.setHeader("Content-Length", compressed.length);
          res.end(compressed);
        } else res.end(data);
      } catch { res.writeHead(404).end(); }
    });
    await new Promise((done) => server.listen(0, "127.0.0.1", done));
    const url = `http://127.0.0.1:${server.address().port}/login`;
    const runs = [];
    try {
      for (let run = 0; run < 3; run++) {
        const context = await browser.newContext();
        const page = await context.newPage();
        const cdp = await context.newCDPSession(page);
        await cdp.send("Network.enable");
        await cdp.send("Network.setBlockedURLs", { urls: ["*://localhost:8000/*", "*://127.0.0.1:54321/*", "https://*"] });
        await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 40, downloadThroughput: 1_250_000, uploadThroughput: 625_000 });
        await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
        await page.addInitScript(() => {
          window.__startupLcp = 0;
          new PerformanceObserver((entries) => { window.__startupLcp = entries.getEntries().at(-1)?.startTime ?? 0; }).observe({ type: "largest-contentful-paint", buffered: true });
        });
        async function snapshot() {
          await page.getByRole("button", { name: "Войти", exact: true }).waitFor();
          await page.waitForLoadState("networkidle");
          return page.evaluate(() => {
            const resources = performance.getEntriesByType("resource").filter((resource) => resource.name.startsWith(location.origin));
            const scripts = resources.filter((resource) => /\.(js|css)$/.test(new URL(resource.name).pathname));
            return {
              lcpMs: Math.round(window.__startupLcp),
              domContentLoadedMs: Math.round(performance.getEntriesByType("navigation")[0].domContentLoadedEventEnd),
              scriptStyleFiles: scripts.length,
              scriptStyleDecodedBytes: scripts.reduce((sum, r) => sum + r.decodedBodySize, 0),
              scriptStyleTransferBytes: scripts.reduce((sum, r) => sum + r.transferSize, 0),
            };
          });
        }
        await page.goto(url);
        const cold = await snapshot();
        await page.reload();
        const warm = await snapshot();
        runs.push({ cold, warm });
        await context.close();
      }
      const html = await readFile(join(root, "index.html"), "utf8");
      reports.push({ directory: root, network: "10 Mbps / 40 ms latency", cpuThrottle: 4, initialHtmlBytes: Buffer.byteLength(html), runs });
    } finally { await new Promise((done) => server.close(done)); }
  }
  console.log(JSON.stringify(reports, null, 2));
} finally { await browser.close(); }
