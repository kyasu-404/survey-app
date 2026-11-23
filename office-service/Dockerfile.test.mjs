import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const dockerfile = readFileSync(new URL('./Dockerfile', import.meta.url), 'utf8');
const compose = readFileSync(new URL('./docker-compose.office.yml', import.meta.url), 'utf8');

test('office-service image is pinned by digest, runs non-root, and defines a healthcheck', () => {
  assert.match(dockerfile, /^FROM node:22-alpine@sha256:[a-f0-9]{64}/m);
  assert.match(dockerfile, /^RUN npm ci --omit=dev/m);
  assert.match(dockerfile, /^USER node$/m);
  assert.match(dockerfile, /^HEALTHCHECK /m);
});

test('office-service compose hardens container limits, tmpfs, and least-privilege DB role', () => {
  assert.match(compose, /PGUSER:\s*\$\{OFFICE_PGUSER:-office_service\}/);
  assert.match(compose, /OFFICE_EMBED_ORIGIN:/);
  assert.match(compose, /stop_grace_period:\s*90s/);
  assert.match(compose, /pids_limit:\s*128/);
  assert.match(compose, /read_only:\s*true/);
  assert.match(compose, /no-new-privileges:true/);
  assert.match(compose, /cap_drop:\s*\[ALL\]/);
  assert.match(compose, /\/tmp:rw,noexec,nosuid,nodev,size=128m/);
});
