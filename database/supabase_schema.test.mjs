import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const schema = readFileSync(new URL("./supabase_schema.sql", import.meta.url), "utf8");
const apiRoleGrantsMigration = readFileSync(
  new URL("./migrations/202604141147_api_role_grants.sql", import.meta.url),
  "utf8",
);
const publicStoragePoliciesMigration = readFileSync(
  new URL("./migrations/202604141430_storage_policies_for_public_uploads.sql", import.meta.url),
  "utf8",
);
const restrictedStorageDeletesMigration = readFileSync(
  new URL("./migrations/202604170130_restrict_public_storage_deletes.sql", import.meta.url),
  "utf8",
);
const restrictedClientFormDeletesMigration = readFileSync(
  new URL("./migrations/202604180900_restrict_client_form_deletes.sql", import.meta.url),
  "utf8",
);
const supabaseLintMigration = readFileSync(
  new URL("./migrations/202604181200_resolve_supabase_lints.sql", import.meta.url),
  "utf8",
);

const safeFormsUpdateColumns =
  "title, schema, form_type, form_reason, is_public, deadline_at, max_responses";

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

function getMigrationPolicyDefinition(migration, policyName) {
  const pattern = new RegExp(`create policy "${policyName}"[\\s\\S]*?;`, "i");
  const match = migration.match(pattern);

  assert.ok(match, `Policy ${policyName} should exist in migration`);
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
  assert.doesNotMatch(schema, /create policy "profiles_update_self"\s+on public\.profiles/i);
  assert.doesNotMatch(schema, /create policy "profiles_update_admin"\s+on public\.profiles/i);

  const profileUpdate = getPolicyDefinition("profiles_update_own_or_admin");

  assert.match(profileUpdate, /for update\s+to authenticated/i);
  assert.match(profileUpdate, /using\s*\(\s*id = \(select auth\.uid\(\)\)\s+or\s+\(select public\.request_role\(\)\) = 'admin'\s*\)/i);
  assert.match(profileUpdate, /with check\s*\(\s*id = \(select auth\.uid\(\)\)\s+or\s+\(select public\.request_role\(\)\) = 'admin'\s*\)/i);

  assert.match(schema, /revoke update on table public\.profiles from authenticated;/i);
  assert.match(schema, /grant update \(name\) on table public\.profiles to authenticated;/i);
});

test("forms cache the author display name without widening profile reads", () => {
  assert.match(schema, /author_name text not null default ''/i);

  const setAuthorName = getFunctionDefinition("set_form_author_name");
  const syncAuthorName = getFunctionDefinition("sync_profile_name_to_forms");

  assert.match(setAuthorName, /security definer\s+set search_path = ''/i);
  assert.match(setAuthorName, /into new\.author_name/i);
  assert.match(setAuthorName, /from public\.profiles p/i);
  assert.match(setAuthorName, /split_part\(p\.email,\s*'@',\s*1\)/i);

  assert.match(syncAuthorName, /security definer\s+set search_path = ''/i);
  assert.match(syncAuthorName, /update public\.forms f/i);
  assert.match(syncAuthorName, /set author_name =/i);
  assert.match(syncAuthorName, /where f\.author_id = new\.id/i);

  assert.match(
    schema,
    /create or replace trigger forms_set_author_name\s+before insert or update of author_id on public\.forms\s+for each row execute procedure public\.set_form_author_name\(\);/i,
  );
  assert.match(
    schema,
    /create or replace trigger profiles_sync_name_to_forms\s+after update of name, email on public\.profiles\s+for each row execute procedure public\.sync_profile_name_to_forms\(\);/i,
  );
});

test("api roles receive the table grants required by PostgREST and RLS", () => {
  assert.match(schema, /grant usage on schema public to anon, authenticated, service_role;/i);
  assert.match(schema, /grant select on table public\.profiles to authenticated;/i);
  assert.match(schema, /grant select on table public\.forms to anon;/i);
  assert.match(schema, /grant select, insert on table public\.forms to authenticated;/i);
  assert.match(schema, /revoke delete on table public\.forms from authenticated;/i);
  assert.match(schema, /revoke update on table public\.forms from authenticated;/i);
  assert.match(
    schema,
    new RegExp(`grant update \\(${safeFormsUpdateColumns}\\) on table public\\.forms to authenticated;`, "i"),
  );
  assert.doesNotMatch(
    schema,
    /grant select, insert, update, delete on table public\.forms to authenticated;/i,
  );
  assert.doesNotMatch(
    schema,
    /grant select, insert, delete on table public\.forms to authenticated;/i,
  );
  assert.match(schema, /grant insert on table public\.responses to anon;/i);
  assert.match(schema, /grant select, insert on table public\.responses to authenticated;/i);
  assert.match(
    schema,
    /grant select, insert, update, delete on table public\.profiles, public\.forms, public\.responses to service_role;/i,
  );
});

test("form rows cannot be deleted directly by authenticated clients", () => {
  assert.doesNotMatch(schema, /create policy "forms_delete"\s+on public\.forms/i);
  assert.match(restrictedClientFormDeletesMigration, /revoke delete on table public\.forms from authenticated;/i);
  assert.match(restrictedClientFormDeletesMigration, /drop policy if exists "forms_delete" on public\.forms;/i);
});

test("api role grants migration restricts form updates to client-editable columns", () => {
  assert.match(apiRoleGrantsMigration, /grant select on table public\.forms to anon;/i);
  assert.match(
    apiRoleGrantsMigration,
    /grant select, insert, delete on table public\.forms to authenticated;/i,
  );
  assert.match(apiRoleGrantsMigration, /revoke update on table public\.forms from authenticated;/i);
  assert.match(
    apiRoleGrantsMigration,
    new RegExp(`grant update \\(${safeFormsUpdateColumns}\\) on table public\\.forms to authenticated;`, "i"),
  );
  assert.doesNotMatch(
    apiRoleGrantsMigration,
    /grant select, insert, update, delete on table public\.forms to authenticated;/i,
  );
});

test("public storage uploads cannot be deleted from anonymous clients", () => {
  assert.doesNotMatch(publicStoragePoliciesMigration, /for delete\s+to anon/i);
  assert.match(restrictedStorageDeletesMigration, /drop policy if exists "survey files delete anon"/i);
  assert.doesNotMatch(restrictedStorageDeletesMigration, /create policy "survey files delete anon"/i);
});

test("storage delete policies are limited to owners, form authors, and admins", () => {
  const initialDeletePolicy = getMigrationPolicyDefinition(
    publicStoragePoliciesMigration,
    "survey files delete authenticated",
  );
  const restrictedDeletePolicy = getMigrationPolicyDefinition(
    restrictedStorageDeletesMigration,
    "survey files delete authenticated",
  );

  for (const policy of [initialDeletePolicy, restrictedDeletePolicy]) {
    assert.match(policy, /for delete\s+to authenticated/i);
    assert.match(policy, /\(storage\.foldername\(name\)\)\[1\] = \(select auth\.uid\(\)\)::text/i);
    assert.match(policy, /f\.author_id = \(select auth\.uid\(\)\)/i);
    assert.match(policy, /\(select public\.request_role\(\)\) = 'admin'/i);
    assert.doesNotMatch(policy, /f\.is_public = true/i);
  }
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

test("authenticated users can read responses for public active admin-authored forms", () => {
  const helper = getFunctionDefinition("is_public_active_admin_authored_form");
  const selectPolicy = getPolicyDefinition("responses_select_author_or_admin");

  assert.match(helper, /security definer\s+set search_path = ''/i);
  assert.match(helper, /from public\.forms f/i);
  assert.match(helper, /join public\.profiles p on p\.id = f\.author_id/i);
  assert.match(helper, /p\.role = 'admin'/i);
  assert.match(helper, /f\.is_public = true/i);
  assert.match(helper, /f\.deadline_at is null or f\.deadline_at > now\(\)/i);
  assert.match(selectPolicy, /public\.is_public_active_admin_authored_form\(form_id\)/i);
  assert.match(
    schema,
    /revoke all on function public\.is_public_active_admin_authored_form\(uuid\) from public;/i,
  );
  assert.match(
    schema,
    /grant execute on function public\.is_public_active_admin_authored_form\(uuid\) to authenticated, service_role;/i,
  );
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

test("forms and responses are published to realtime", () => {
  assert.match(schema, /alter publication supabase_realtime add table public\.forms;/i);
  assert.match(schema, /alter publication supabase_realtime add table public\.responses;/i);
});

test("list and search indexes support stable paginated reads", () => {
  assert.match(schema, /create schema if not exists extensions;/i);
  assert.match(schema, /create extension if not exists "pg_trgm" with schema extensions;/i);
  assert.doesNotMatch(schema, /create extension if not exists "pg_trgm";/i);
  assert.match(schema, /grant usage on schema extensions to anon, authenticated, service_role;/i);
  assert.match(schema, /create index idx_forms_created_at_id\s+on public\.forms\(created_at desc,\s*id desc\);/i);
  assert.match(
    schema,
    /create index idx_forms_author_created_at_id\s+on public\.forms\(author_id,\s*created_at desc,\s*id desc\);/i,
  );
  assert.match(
    schema,
    /create index idx_responses_form_created_at_id\s+on public\.responses\(form_id,\s*created_at desc,\s*id desc\);/i,
  );
  assert.match(schema, /create index idx_forms_title_trgm\s+on public\.forms using gin \(title extensions\.gin_trgm_ops\);/i);
  assert.match(
    schema,
    /create index idx_forms_author_name_trgm\s+on public\.forms using gin \(author_name extensions\.gin_trgm_ops\);/i,
  );
});

test("supabase lint migration moves pg_trgm and merges profile update policies", () => {
  assert.match(supabaseLintMigration, /create schema if not exists extensions;/i);
  assert.match(supabaseLintMigration, /create extension if not exists "pg_trgm" with schema extensions;/i);
  assert.match(supabaseLintMigration, /alter extension "pg_trgm" set schema extensions;/i);
  assert.match(supabaseLintMigration, /drop policy if exists "profiles_update_self" on public\.profiles;/i);
  assert.match(supabaseLintMigration, /drop policy if exists "profiles_update_admin" on public\.profiles;/i);
  assert.match(supabaseLintMigration, /create policy "profiles_update_own_or_admin"[\s\S]*?for update\s+to authenticated/i);
});

test("dashboard form stats use one aggregate rpc with nullable filters", () => {
  const statsFunction = getFunctionDefinition("get_dashboard_forms_stats");

  assert.doesNotMatch(statsFunction, /security definer/i);
  assert.match(
    statsFunction,
    /returns table\s*\(\s*total_count bigint,\s*active_count bigint,\s*forms_with_deadline_count bigint\s*\)/i,
  );
  assert.match(statsFunction, /from public\.forms f/i);
  assert.match(statsFunction, /f\.form_type <> 'template'/i);
  assert.match(statsFunction, /count\(\*\) filter \(where f\.is_public = true\)/i);
  assert.match(statsFunction, /count\(\*\) filter \(where f\.deadline_at is not null\)/i);
  assert.match(
    schema,
    /grant execute on function public\.get_dashboard_forms_stats\(text, timestamptz, timestamptz, uuid, text, text, boolean\) to authenticated, service_role;/i,
  );
});
