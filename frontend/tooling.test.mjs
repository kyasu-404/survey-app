import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const packageJson = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));
const productionProxy = readFileSync(new URL("../nginx.conf", import.meta.url), "utf8");
const deploymentGuide = readFileSync(new URL("../README.md", import.meta.url), "utf8");

test("frontend exposes a TypeScript typecheck script", () => {
  assert.equal(packageJson.scripts?.typecheck, "tsc --noEmit");
  assert.ok(existsSync(new URL("./tsconfig.json", import.meta.url)), "frontend/tsconfig.json should exist");
});

test("frontend no longer depends on vulnerable xlsx package", () => {
  assert.equal(packageJson.dependencies?.xlsx, undefined);
  assert.match(packageJson.dependencies?.exceljs ?? "", /^\^?\d+\.\d+\.\d+/);
});

test("repository has a CI workflow for tests and typecheck", () => {
  const workflowPath = new URL("../.github/workflows/ci.yml", import.meta.url);
  assert.ok(existsSync(workflowPath), ".github/workflows/ci.yml should exist");

  const workflow = readFileSync(workflowPath, "utf8");
  assert.match(workflow, /npm run typecheck/);
  assert.match(workflow, /npm run test:coverage/);
  assert.match(workflow, /node --test/);
});

test("frontend exposes production release-gate scripts", () => {
  assert.equal(packageJson.scripts?.lint, "eslint . --max-warnings=0");
  assert.equal(packageJson.scripts?.["test:coverage"], "vitest run --coverage");
  assert.equal(packageJson.scripts?.["audit:prod"], "npm audit --omit=dev --audit-level=high");
  assert.equal(packageJson.scripts?.["build:budget"], "node scripts/check-bundle-budget.mjs");
  assert.equal(packageJson.scripts?.["test:e2e"], "playwright test");
});

test("frontend document declares mobile viewport baseline", () => {
  const html = readFileSync(new URL("./index.html", import.meta.url), "utf8");

  assert.match(html, /<meta\s+name="viewport"\s+content="width=device-width,\s*initial-scale=1"\s*\/?>/);
});

test("CI workflow gates production releases", () => {
  const workflowPath = new URL("../.github/workflows/ci.yml", import.meta.url);
  const workflow = readFileSync(workflowPath, "utf8");

  assert.match(workflow, /database\/migrations\.test\.mjs/);
  assert.match(workflow, /npm run audit:prod/);
  assert.match(workflow, /npm run lint/);
  assert.match(workflow, /npm run test:coverage/);
  assert.match(workflow, /npm run build:budget/);
  assert.match(workflow, /npx playwright install --with-deps chromium/);
  assert.match(workflow, /npm run test:e2e/);
  assert.match(workflow, /aquasecurity\/trivy-action@[a-f0-9]{40}/);
  assert.doesNotMatch(workflow, /uses:\s+[^\s]+@v\d/i);
});

test("production proxy applies a dedicated anonymous upload rate limit", () => {
  assert.match(productionProxy, /limit_req_zone\s+\$binary_remote_addr\s+zone=survey_uploads:\d+m\s+rate=1r\/s;/);
  assert.match(productionProxy, /location\s+\^~\s+\/api\/storage\/v1\/object\/survey-files\//);
  assert.match(productionProxy, /limit_req\s+zone=survey_uploads\s+burst=5\s+nodelay;/);
  assert.match(productionProxy, /Do not expose Kong directly in production/i);
});

test("production proxy rate-limits the actual response RPC and handles realtime upgrades", () => {
  assert.match(productionProxy, /location\s+=\s+\/api\/rest\/v1\/rpc\/submit_form_response/);
  assert.match(productionProxy, /limit_req\s+zone=survey_responses\s+burst=6\s+nodelay;/);
  assert.match(productionProxy, /limit_except\s+POST\s+OPTIONS\s+\{\s*deny all;\s*\}/);
  assert.doesNotMatch(productionProxy, /location\s+=\s+\/api\/rest\/v1\/responses/);
  assert.match(productionProxy, /location\s+\^~\s+\/api\/realtime\//);
  assert.match(productionProxy, /proxy_set_header\s+Upgrade\s+\$http_upgrade;/);
});

test("production proxy redirects HTTP and does not allow arbitrary remote theme images", () => {
  assert.match(productionProxy, /listen\s+80;/);
  assert.match(productionProxy, /return\s+301\s+https:\/\/\$host\$request_uri;/);
  assert.match(productionProxy, /ssl_protocols\s+TLSv1\.2\s+TLSv1\.3;/);
  assert.doesNotMatch(productionProxy, /img-src[^;]*\shttps:/i);
});

test("deployment guide disables public registration while keeping email sign-in enabled", () => {
  assert.match(deploymentGuide, /`DISABLE_SIGNUP=true`/);
  assert.match(deploymentGuide, /`ENABLE_EMAIL_SIGNUP=true`/);
  assert.match(deploymentGuide, /`ENABLE_PHONE_SIGNUP=false`/);
  assert.match(deploymentGuide, /`ENABLE_PHONE_AUTOCONFIRM=false`/);
});
