import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
const dockerSource = readFileSync(
  new URL("../../supabase/docker/volumes/functions/user-admin/index.ts", import.meta.url),
  "utf8",
);

test("pins the Supabase client import to an exact version", () => {
  assert.match(source, /@supabase\/supabase-js@2\.\d+\.\d+/);
  assert.doesNotMatch(source, /@supabase\/supabase-js@2["']/);
});

test("uses an explicit CORS allowlist instead of wildcard origin", () => {
  assert.doesNotMatch(source, /"Access-Control-Allow-Origin": "\*"/);
  assert.match(source, /USER_ADMIN_ALLOWED_ORIGINS/);
  assert.match(source, /Vary": "Origin"/);
  assert.match(source, /isOriginAllowed/);
  assert.match(source, /x-request-id/);
  assert.match(source, /traceparent/);
});

test("allows private-network development origins without wildcard CORS", () => {
  [source, dockerSource].forEach((fileSource) => {
    assert.doesNotMatch(fileSource, /"Access-Control-Allow-Origin": "\*"/);
    assert.match(fileSource, /USER_ADMIN_ALLOWED_ORIGINS/);
    assert.match(fileSource, /isDefaultLocalDevelopmentOrigin/);
    assert.match(fileSource, /isPrivateNetworkHostname/);
    assert.match(fileSource, /172\\\.\(1\[6-9\]\|2\\d\|3\[0-1\]\)\\\./);
    assert.match(fileSource, /defaultAllowedDevelopmentPorts/);
  });
});

test("logs request correlation context for user-admin actions", () => {
  assert.match(source, /createRequestLogContext/);
  assert.match(source, /requestId: req\.headers\.get\("x-request-id"\)/);
  assert.match(source, /traceparent: req\.headers\.get\("traceparent"\)/);
  assert.match(source, /release: req\.headers\.get\("x-client-release"\)/);
  assert.match(source, /console\.info\("user-admin action started"/);
  assert.match(source, /console\.error\("user-admin action failed"/);
});

test("does not mirror authorization roles into user metadata", () => {
  assert.doesNotMatch(source, /user_metadata:\s*\{[^}]*role/s);
  assert.doesNotMatch(source, /getUserMetadataWithRole/);
});

test("rolls back a newly created auth user when profile persistence fails", () => {
  const createCase = source.match(/case "create":[\s\S]*?case "delete":/);

  assert.ok(createCase, "create action should exist");
  assert.match(createCase[0], /const createdUserId = data\.user\?\.id/);
  assert.match(createCase[0], /if \(profileError\) \{[\s\S]*?await adminClient\.auth\.admin\.deleteUser\(createdUserId\)/);
  assert.match(createCase[0], /rollbackError/);
  assert.match(createCase[0], /rolled back/i);
  assert.match(createCase[0], /partially created/i);
});
