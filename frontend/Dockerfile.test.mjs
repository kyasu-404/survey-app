import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const dockerfile = readFileSync(new URL("./Dockerfile", import.meta.url), "utf8");

test("Dockerfile builds a production image on Node 20 and serves static assets", () => {
  assert.match(dockerfile, /FROM node:20(?:\.\d+)?-alpine AS build/i);
  assert.match(dockerfile, /RUN npm ci/);
  assert.match(dockerfile, /RUN npm run build/);
  assert.match(dockerfile, /FROM nginx:/i);
  assert.doesNotMatch(dockerfile, /npm run dev/);
});
