import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const dockerfile = readFileSync(new URL("./Dockerfile", import.meta.url), "utf8");
const compose = readFileSync(new URL("./docker-compose.mail-worker.yml", import.meta.url), "utf8");
const workerSource = readFileSync(new URL("./src/index.mjs", import.meta.url), "utf8");

test("mail worker image is reproducible and runs without root privileges", () => {
  assert.match(dockerfile, /FROM node:22-alpine@sha256:[a-f0-9]{64}/);
  assert.match(dockerfile, /npm ci --omit=dev --ignore-scripts/);
  assert.match(dockerfile, /USER node/);
  assert.match(dockerfile, /HEALTHCHECK/);
});

test("Supabase overlay injects secrets without publishing the health port", () => {
  assert.match(compose, /SUPABASE_SERVICE_ROLE_KEY: \$\{SERVICE_ROLE_KEY\}/);
  assert.match(compose, /MAIL_SETTINGS_ENCRYPTION_KEY: \$\{MAIL_SETTINGS_ENCRYPTION_KEY\}/);
  assert.match(compose, /STORAGE_CLEANUP_RETENTION_HOURS: \$\{STORAGE_CLEANUP_RETENTION_HOURS:-168\}/);
  assert.match(compose, /STORAGE_CLEANUP_INTERVAL_HOURS: \$\{STORAGE_CLEANUP_INTERVAL_HOURS:-24\}/);
  assert.doesNotMatch(compose, /^\s+ports:/m);
});

test("mail worker schedules storage maintenance independently from SMTP polling", () => {
  assert.match(workerSource, /runScheduledStorageCleanup/);
  assert.match(workerSource, /scheduleCleanup\(\);/);
  assert.match(workerSource, /setInterval\(scheduleCleanup, cleanupCheckIntervalMs\)/);
  assert.match(workerSource, /\/storage\/v1\/object\/\$\{encodeURIComponent\(bucket\)\}/);
});
