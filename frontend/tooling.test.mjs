import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const packageJson = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));

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
  assert.match(workflow, /aquasecurity\/trivy-action/);
});
