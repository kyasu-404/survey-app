import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./index.ts", import.meta.url), "utf8");

test("pins the Supabase client import to an exact version", () => {
  assert.match(source, /@supabase\/supabase-js@2\.\d+\.\d+/);
  assert.doesNotMatch(source, /@supabase\/supabase-js@2["']/);
});

test("uses an explicit CORS allowlist instead of wildcard origin", () => {
  assert.doesNotMatch(source, /"Access-Control-Allow-Origin": "\*"/);
  assert.match(source, /FORM_ADMIN_ALLOWED_ORIGINS/);
  assert.match(source, /Vary": "Origin"/);
  assert.match(source, /isOriginAllowed/);
  assert.match(source, /x-request-id/);
  assert.match(source, /traceparent/);
});

test("allows private-network development origins without wildcard CORS", () => {
  assert.doesNotMatch(source, /"Access-Control-Allow-Origin": "\*"/);
  assert.match(source, /FORM_ADMIN_ALLOWED_ORIGINS/);
  assert.match(source, /isDefaultLocalDevelopmentOrigin/);
  assert.match(source, /isPrivateNetworkHostname/);
  assert.match(source, /172\\\.\(1\[6-9\]\|2\\d\|3\[0-1\]\)\\\./);
  assert.match(source, /defaultAllowedDevelopmentPorts/);
});

test("logs request correlation context for form-admin actions", () => {
  assert.match(source, /createRequestLogContext/);
  assert.match(source, /requestId: req\.headers\.get\("x-request-id"\)/);
  assert.match(source, /traceparent: req\.headers\.get\("traceparent"\)/);
  assert.match(source, /release: req\.headers\.get\("x-client-release"\)/);
  assert.match(source, /console\.info\("form-admin action started"/);
  assert.match(source, /console\.error\("form-admin action failed"/);
});

test("authorizes form deletion by requester ownership or admin role", () => {
  assert.match(source, /authClient\.auth\.getUser\(jwt\)/);
  assert.match(source, /\.from\("forms"\)\s*[\s\S]*?\.select\("id, author_id"\)/);
  assert.match(source, /form\.author_id !== requester\.id/);
  assert.match(source, /requesterProfile\?\.role !== "admin"/);
});

test("removes storage objects before deleting the form row", () => {
  const removeIndex = source.indexOf("removeStorageObjectsForForm");
  const deleteMatch = source.match(/\.from\("forms"\)\s*\.delete\(\)/);

  assert.notEqual(removeIndex, -1);
  assert.ok(deleteMatch);
  assert.ok(removeIndex < deleteMatch.index);
});
