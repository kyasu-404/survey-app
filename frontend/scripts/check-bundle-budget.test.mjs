import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

const templatesRoute = "src/pages/TemplatesPage/TemplatesPage.tsx";
const surveyRoute = "src/pages/SurveyPage/SurveyPage.tsx";

function createBundleFixture(t) {
  const root = mkdtempSync(join(tmpdir(), "survey-bundle-budget-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const script = join(root, "scripts/check-bundle-budget.mjs");
  mkdirSync(dirname(script), { recursive: true });
  copyFileSync(new URL("./check-bundle-budget.mjs", import.meta.url), script);

  const manifest = {
    "index.html": {
      file: "assets/index-fixture.js",
      isEntry: true,
      imports: ["runtime"],
      css: ["assets/index-fixture.css"],
      dynamicImports: [templatesRoute, surveyRoute, "builder"],
    },
    runtime: { file: "assets/runtime-fixture.js" },
    [templatesRoute]: {
      file: "assets/TemplatesPage-fixture.js",
      isDynamicEntry: true,
      imports: ["api"],
      dynamicImports: ["survey-core"],
    },
    [surveyRoute]: {
      file: "assets/SurveyPage-fixture.js",
      isDynamicEntry: true,
      imports: ["api"],
      dynamicImports: ["survey-core", "survey-react-ui"],
    },
    builder: {
      file: "assets/BuilderPage-fixture.js",
      isDynamicEntry: true,
      imports: ["api", "survey-core", "survey-creator-core", "survey-react-ui", "exceljs", "sentry", "shared"],
    },
    api: { file: "assets/rpc-realtime-upload-fixture.js", imports: ["runtime"] },
    "survey-core": { file: "assets/survey-core-fixture.js" },
    "survey-creator-core": { file: "assets/survey-creator-core-fixture.js" },
    "survey-react-ui": { file: "assets/survey-react-ui-fixture.js" },
    exceljs: { file: "assets/exceljs-fixture.js" },
    sentry: { file: "assets/sentry-fixture.js" },
    shared: { file: "assets/lazy-shared-fixture.js" },
  };
  const files = new Map(Object.entries({
    "assets/index-fixture.js": 500_000,
    "assets/runtime-fixture.js": 200_000,
    "assets/index-fixture.css": 20_000,
    "assets/TemplatesPage-fixture.js": 200_000,
    "assets/SurveyPage-fixture.js": 120_000,
    "assets/BuilderPage-fixture.js": 500_000,
    "assets/rpc-realtime-upload-fixture.js": 250_000,
    "assets/survey-core-fixture.js": 1_600_000,
    "assets/survey-creator-core-fixture.js": 1_600_000,
    "assets/survey-react-ui-fixture.js": 450_000,
    "assets/exceljs-fixture.js": 900_000,
    "assets/sentry-fixture.js": 300_000,
  }).map(([path, size]) => [path, Buffer.alloc(size, " ")]));

  return {
    manifest,
    files,
    run(totalBytes = 7_400_000) {
      const manifestData = Buffer.from(JSON.stringify(manifest));
      const fixedBytes = [...files.values()].reduce((total, data) => total + data.byteLength, manifestData.byteLength);
      const sharedBytes = totalBytes - fixedBytes;
      assert.ok(sharedBytes >= 0 && sharedBytes <= 1_000_000, "fixture must keep the shared lazy chunk within its file budget");
      const outputFiles = new Map(files);
      outputFiles.set("assets/lazy-shared-fixture.js", Buffer.alloc(sharedBytes, " "));
      outputFiles.set(".vite/manifest.json", manifestData);
      for (const [path, data] of outputFiles) {
        const output = join(root, "dist", path);
        mkdirSync(dirname(output), { recursive: true });
        writeFileSync(output, data);
      }
      const result = spawnSync(process.execPath, [script], { encoding: "utf8" });
      assert.ifError(result.error);
      return result;
    },
  };
}

test("accepts a 7.4 MB build with lazy routes and heavy features", (t) => {
  const result = createBundleFixture(t).run();
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Bundle budget passed:/);
  assert.match(result.stdout, /Initial JS\/CSS: 3 files,/);
});

test("rejects total growth beyond 7.5 MB even when each lazy chunk fits", (t) => {
  const result = createBundleFixture(t).run(7_500_001);
  assert.equal(result.status, 1, result.stdout);
  assert.match(result.stderr, /dist total .* exceeds/);
  assert.doesNotMatch(result.stderr, /Initial JS\/CSS|(?:raw|gzip) size|static dependency/);
});

test("rejects an oversized static import tree below the total budget", (t) => {
  const fixture = createBundleFixture(t);
  fixture.files.set("assets/index-fixture.js", Buffer.alloc(650_001, " "));
  const result = fixture.run(7_300_000);
  assert.equal(result.status, 1, result.stdout);
  assert.match(result.stderr, /Initial JS\/CSS .* exceeds budget/);
  assert.doesNotMatch(result.stderr, /dist total|Lazy feature|raw size/);
});

for (const dependency of ["survey-core", "survey-creator-core", "survey-react-ui", "exceljs", "sentry"]) {
  test(`rejects ${dependency} when it becomes a startup dependency`, (t) => {
    const fixture = createBundleFixture(t);
    fixture.manifest.runtime.imports = [dependency];
    const result = fixture.run(7_300_000);
    assert.equal(result.status, 1, result.stdout);
    assert.match(result.stderr, new RegExp(`Lazy feature unexpectedly loaded at startup: assets/${dependency}-fixture\\.js`));
    assert.doesNotMatch(result.stderr, /dist total/);
  });
}

test("rejects a heavy renderer statically imported by the templates route", (t) => {
  const fixture = createBundleFixture(t);
  fixture.manifest[templatesRoute].imports.push("survey-core");
  const result = fixture.run(7_300_000);
  assert.equal(result.status, 1, result.stdout);
  assert.match(result.stderr, /Unexpected static dependency of src\/pages\/TemplatesPage\/TemplatesPage\.tsx: assets\/survey-core-fixture\.js/);
  assert.doesNotMatch(result.stderr, /dist total|Lazy feature|Initial JS\/CSS/);
});

test("rejects private page code statically imported by the public survey route", (t) => {
  const fixture = createBundleFixture(t);
  fixture.manifest.dashboard = { file: "assets/DashboardPage-fixture.js" };
  fixture.manifest[surveyRoute].imports.push("dashboard");
  fixture.files.set("assets/DashboardPage-fixture.js", Buffer.alloc(10_000, " "));
  const result = fixture.run(7_300_000);
  assert.equal(result.status, 1, result.stdout);
  assert.match(result.stderr, /Unexpected static dependency of src\/pages\/SurveyPage\/SurveyPage\.tsx: assets\/DashboardPage-fixture\.js/);
  assert.doesNotMatch(result.stderr, /dist total|Lazy feature|Initial JS\/CSS/);
});
