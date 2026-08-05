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
  assert.match(source, /requesterProfile\.role !== "admin"/);
});

test("rejects disabled owners and administrators", () => {
  assert.match(source, /\.select\("role, is_disabled"\)/);
  assert.match(source, /requesterProfile\?\.is_disabled/);
});

test("removes storage objects before deleting the form row", () => {
  const removeIndex = source.indexOf("removeStorageObjectsForForm");
  const removeAssetsIndex = source.indexOf("removeSurveyAssetsForForm");
  const deleteMatch = source.match(/\.from\("forms"\)\s*\.delete\(\)/);

  assert.notEqual(removeIndex, -1);
  assert.notEqual(removeAssetsIndex, -1);
  assert.ok(deleteMatch);
  assert.ok(removeIndex < deleteMatch.index);
  assert.ok(removeAssetsIndex < deleteMatch.index);
  assert.match(source, /SURVEY_ASSETS_BUCKET/);
  assert.match(source, /\.from\("response_file_references"\)\s*\.select\("object_path"\)\s*\.eq\("form_id", formId\)/);
  assert.match(source, /removeStorageTree\(adminClient, surveyAssetsBucket, `forms\/\$\{formId\}`\)/);
  assert.match(source, /\.storage\.from\(bucketName\)\.remove\(batch\)/);
  assert.doesNotMatch(source, /\.schema\("storage"\)/);
});

test("offers an admin-only cleanup for stale unreferenced public uploads", () => {
  assert.match(source, /action: "cleanup-orphans"/);
  assert.match(source, /requesterProfile\.role !== "admin"/);
  assert.match(source, /\.rpc\("list_orphan_survey_files"/);
  assert.match(source, /olderThanHours/);
  assert.match(source, /removeStaleDraftSurveyAssets/);
  assert.match(source, /listStorageEntries\(adminClient, surveyAssetsBucket, "forms"\)/);
  assert.match(source, /assetEntry\.created_at >= cutoff/);
  assert.match(source, /removedAssets/);
});

test("deletes only an exact unreferenced anonymous upload capability", () => {
  assert.match(source, /action: "delete-upload"/);
  assert.match(source, /isAnonymousUploadPath/);
  assert.match(source, /\.rpc\("is_survey_file_referenced"/);
  assert.match(source, /isReferenced !== false/);
  assert.match(source, /\.remove\(\[payload\.path\]\)/);
});

test("deletes selected responses only for the form owner or an admin and removes referenced files", () => {
  assert.match(source, /action: "delete-responses"/);
  assert.match(source, /getUniqueResponseIds/);
  assert.match(source, /value\.length > 100/);
  assert.match(source, /form\.author_id !== requester\.id/);
  assert.match(source, /\.from\("response_file_references"\)/);
  assert.match(source, /\.in\("response_id", existingResponseIds\)/);
  assert.match(source, /adminClient\.storage\.from\(storageBucket\)\.remove\(batch\)/);
  assert.match(source, /\.from\("responses"\)\s*\.delete\(\)/);
});
