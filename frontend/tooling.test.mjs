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
  assert.match(workflow, /npm test/);
  assert.match(workflow, /node --test/);
});
