import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const schema = readFileSync(new URL("./supabase_schema.sql", import.meta.url), "utf8");

function getFunctionDefinition(functionName) {
  const pattern = new RegExp(
    `create or replace function public\\.${functionName}\\([\\s\\S]*?\\n\\$\\$;`,
    "i"
  );
  const match = schema.match(pattern);

  assert.ok(match, `Function ${functionName} should exist`);
  return match[0];
}

function getPolicyDefinition(policyName) {
  const pattern = new RegExp(`create policy "${policyName}"[\\s\\S]*?;`, "i");
  const match = schema.match(pattern);

  assert.ok(match, `Policy ${policyName} should exist`);
  return match[0];
}

test("new profiles always start with user role and do not copy metadata roles", () => {
  const handleNewUser = getFunctionDefinition("handle_new_user");

  assert.match(handleNewUser, /security definer\s+set search_path = ''/i);
  assert.match(handleNewUser, /new\.email,\s*'user'/i);
  assert.doesNotMatch(handleNewUser, /raw_user_meta_data\s*->>\s*'role'/i);
  assert.doesNotMatch(handleNewUser, /role\s*=\s*coalesce/i);
});

test("schema baseline avoids destructive reset statements", () => {
  assert.match(schema, /^\s*(?:--[^\n]*\n\s*)*begin;/i);
  assert.match(schema, /\bcommit;\s*$/i);

  assert.doesNotMatch(schema, /^\s*drop\s+/im);
  assert.doesNotMatch(schema, /^\s*truncate\s+/im);
  assert.doesNotMatch(schema, /^\s*delete\s+from\s+/im);
});

test("request_role only trusts the profiles table", () => {
  const requestRole = getFunctionDefinition("request_role");

  assert.match(requestRole, /security definer\s+set search_path = ''/i);
  assert.match(requestRole, /from public\.profiles p/i);
  assert.doesNotMatch(requestRole, /auth\.jwt/i);
  assert.doesNotMatch(requestRole, /user_metadata/i);
});

test("all security definer functions pin search_path", () => {
  const definitions = schema.match(/create or replace function public\.[\s\S]*?\n\$\$;/gi) ?? [];
  const securityDefiners = definitions.filter((definition) => /security definer/i.test(definition));

  assert.ok(securityDefiners.length > 0, "Expected at least one SECURITY DEFINER function");

  for (const definition of securityDefiners) {
    assert.match(definition, /security definer\s+set search_path = ''/i);
  }
});

test("authenticated users can update only safe profile columns", () => {
  assert.doesNotMatch(schema, /create policy "profiles_update"\s+on public\.profiles/i);

  const selfUpdate = getPolicyDefinition("profiles_update_self");
  const adminUpdate = getPolicyDefinition("profiles_update_admin");

  assert.match(selfUpdate, /for update\s+to authenticated/i);
  assert.match(selfUpdate, /using\s*\(\s*id = \(select auth\.uid\(\)\)\s*\)/i);
  assert.match(selfUpdate, /with check\s*\(\s*id = \(select auth\.uid\(\)\)\s*\)/i);

  assert.match(adminUpdate, /for update\s+to authenticated/i);
  assert.match(adminUpdate, /\(select public\.request_role\(\)\) = 'admin'/i);

  assert.match(schema, /revoke update on table public\.profiles from authenticated;/i);
  assert.match(schema, /grant update \(name\) on table public\.profiles to authenticated;/i);
});

test("api roles receive the table grants required by PostgREST and RLS", () => {
  assert.match(schema, /grant usage on schema public to anon, authenticated, service_role;/i);
  assert.match(schema, /grant select on table public\.profiles to authenticated;/i);
  assert.match(schema, /grant select on table public\.forms to anon;/i);
  assert.match(schema, /grant select, insert, update, delete on table public\.forms to authenticated;/i);
  assert.match(schema, /grant insert on table public\.responses to anon;/i);
  assert.match(schema, /grant select, insert on table public\.responses to authenticated;/i);
  assert.match(
    schema,
    /grant select, insert, update, delete on table public\.profiles, public\.forms, public\.responses to service_role;/i,
  );
});

test("response inserts are attributed to the current auth user", () => {
  const setResponseUserId = getFunctionDefinition("set_response_user_id");

  assert.match(setResponseUserId, /security definer\s+set search_path = ''/i);
  assert.match(setResponseUserId, /new\.user_id\s*:=\s*auth\.uid\(\);/i);
  assert.match(
    schema,
    /create or replace trigger responses_set_user_id\s+before insert on public\.responses\s+for each row execute procedure public\.set_response_user_id\(\);/i,
  );

  const insertPolicy = getPolicyDefinition("responses_insert");
  assert.match(insertPolicy, /user_id is null\s+or user_id = \(select auth\.uid\(\)\)/i);
});

test("form authors and admins can read responses", () => {
  assert.doesNotMatch(schema, /create policy "responses_select"\s+on public\.responses/i);

  const selectPolicy = getPolicyDefinition("responses_select_author_or_admin");

  assert.match(selectPolicy, /\(select public\.request_role\(\)\) = 'admin'/i);
  assert.match(selectPolicy, /from public\.forms f/i);
  assert.match(selectPolicy, /f\.id = form_id/i);
  assert.match(selectPolicy, /f\.author_id = \(select auth\.uid\(\)\)/i);
});

test("response limits use an atomic form counter instead of counting response rows", () => {
  assert.match(schema, /responses_count integer not null default 0/i);

  const ensureLimit = getFunctionDefinition("ensure_form_response_limit");

  assert.doesNotMatch(ensureLimit, /count\s*\(\s*\*\s*\)/i);
  assert.match(ensureLimit, /update public\.forms f\s+set responses_count = f\.responses_count \+ 1/i);
  assert.match(ensureLimit, /f\.max_responses is null\s+or f\.responses_count < f\.max_responses/i);
  assert.match(
    schema,
    /create or replace trigger responses_form_count_decrement\s+after delete on public\.responses\s+for each row execute procedure public\.decrement_form_response_count\(\);/i,
  );
});
