import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const schema = readFileSync(new URL("./supabase_schema.sql", import.meta.url), "utf8");
const apiRoleGrantsMigration = readFileSync(
  new URL("./migrations/202604141147_api_role_grants.sql", import.meta.url),
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
const securityHardeningMigration = readFileSync(
  new URL("./migrations/202607161200_security_hardening.sql", import.meta.url),
  "utf8",
);
const securityFollowupMigration = readFileSync(
  new URL("./migrations/202607161900_security_followup.sql", import.meta.url),
  "utf8",
);
const formThemesMigration = readFileSync(
  new URL("./migrations/202607171200_add_form_themes_and_assets.sql", import.meta.url),
  "utf8",
);
const responseManagementMigration = readFileSync(
  new URL("./migrations/202608031200_response_management.sql", import.meta.url),
  "utf8",
);
const organizationDirectoryMigration = readFileSync(
  new URL("./migrations/202608031300_organization_directory.sql", import.meta.url),
  "utf8",
);

const safeFormsUpdateColumns =
  "title, schema, theme, form_type, form_reason, is_public, deadline_at, max_responses, allow_response_editing, organization_types";
const legacySafeFormsUpdateColumns =
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

test("new profiles always start with user role and do not copy metadata roles", () => {
  const handleNewUser = getFunctionDefinition("handle_new_user");

  assert.match(handleNewUser, /security definer\s+set search_path = ''/i);
  assert.match(handleNewUser, /new\.email,\s*'user'/i);
  assert.doesNotMatch(handleNewUser, /raw_user_meta_data\s*->>\s*'role'/i);
  assert.doesNotMatch(handleNewUser, /role\s*=\s*coalesce/i);
});

test("schema baseline avoids destructive reset statements", () => {
  const allowlistedTriggerMaintenance = schema.replace(
    /^\s*delete\s+from\s+public\.response_file_references\s+where\s+response_id\s*=\s*new\.id;\s*$/gim,
    "",
  );

  assert.match(schema, /^\s*(?:--[^\n]*\n\s*)*begin;/i);
  assert.match(schema, /\bcommit;\s*$/i);

  assert.doesNotMatch(allowlistedTriggerMaintenance, /^\s*drop\s+/im);
  assert.doesNotMatch(allowlistedTriggerMaintenance, /^\s*truncate\s+/im);
  assert.doesNotMatch(allowlistedTriggerMaintenance, /^\s*delete\s+from\s+/im);
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
  assert.match(profileUpdate, /select public\.request_is_enabled\(\)/i);
  assert.match(profileUpdate, /id = \(select auth\.uid\(\)\) or \(select public\.request_role\(\)\) = 'admin'/i);
  assert.match(profileUpdate, /with check/i);

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
  assert.match(schema, /grant select on table public\.forms to authenticated;/i);
  assert.match(schema, /grant insert \(id, title, schema, theme, form_type, form_reason, is_public, deadline_at, max_responses, allow_response_editing, organization_types, author_id\)\s+on table public\.forms to authenticated;/i);
  assert.doesNotMatch(schema, /grant insert \([^)]*responses_count/i);
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
  assert.match(schema, /revoke insert on table public\.responses from anon;/i);
  assert.match(schema, /grant select on table public\.responses to authenticated;/i);
  assert.match(schema, /revoke insert on table public\.responses from authenticated;/i);
  assert.match(schema, /grant execute on function public\.get_form_response_status\(uuid, uuid\) to anon, authenticated, service_role;/i);
  assert.match(schema, /grant execute on function public\.submit_form_response\(uuid, uuid, uuid, jsonb\) to anon, authenticated, service_role;/i);
  assert.match(
    schema,
    /grant select, insert, update, delete on table public\.profiles, public\.education_organizations, public\.forms, public\.responses to service_role;/i,
  );
});

test("form rows cannot be deleted directly by authenticated clients", () => {
  assert.doesNotMatch(schema, /create policy "forms_delete"\s+on public\.forms/i);
  assert.match(restrictedClientFormDeletesMigration, /revoke delete on table public\.forms from authenticated;/i);
  assert.match(restrictedClientFormDeletesMigration, /drop policy if exists "forms_delete" on public\.forms;/i);
});

test("authenticated users see own, admin-visible, or active public forms only", () => {
  const selectPolicy = getPolicyDefinition("forms_select");
  const anonSelectPolicy = getPolicyDefinition("forms_select_anon");

  assert.match(selectPolicy, /for select\s+to authenticated/i);
  assert.match(selectPolicy, /select public\.request_is_enabled\(\)/i);
  assert.match(selectPolicy, /author_id = \(select auth\.uid\(\)\)/i);
  assert.match(selectPolicy, /select public\.request_role\(\).*?= 'admin'/is);
  assert.match(selectPolicy, /public\.is_public_active_form\(id\)/i);

  assert.match(anonSelectPolicy, /for select\s+to anon/i);
  assert.match(anonSelectPolicy, /public\.is_public_active_form\(id\)/i);
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
    new RegExp(`grant update \\(${legacySafeFormsUpdateColumns}\\) on table public\\.forms to authenticated;`, "i"),
  );
  assert.doesNotMatch(
    apiRoleGrantsMigration,
    /grant select, insert, update, delete on table public\.forms to authenticated;/i,
  );
});

test("form themes are stored separately and constrained to safe compact JSON", () => {
  assert.match(schema, /theme jsonb not null default '\{\}'::jsonb/i);
  assert.match(schema, /create or replace function public\.survey_theme_is_safe\(value jsonb\)/i);
  assert.match(schema, /pg_column_size\(value\) <= 131072/i);
  assert.match(schema, /forms_theme_is_safe check \(public\.survey_theme_is_safe\(theme\)\)/i);
  assert.match(formThemesMigration, /add column if not exists theme jsonb not null default '\{\}'::jsonb/i);
  assert.match(formThemesMigration, /grant update \(title, schema, theme,/i);
});

test("survey assets separate common gallery objects from per-form uploads", () => {
  assert.match(schema, /values \(\s*'survey-assets',\s*'survey-assets',\s*true,\s*5242880/is);
  assert.match(schema, /name like 'gallery\/%' or public\.can_manage_survey_asset\(name\)/i);
  assert.match(schema, /path_parts\[1\] <> 'forms'/i);
  assert.match(schema, /path_parts\[3\] <> auth\.uid\(\)::text/i);
  assert.match(schema, /\(jpg\|jpeg\|png\|webp\)/i);
  assert.match(formThemesMigration, /survey_assets_authenticated_upload/i);
  assert.match(formThemesMigration, /survey_assets_authenticated_delete/i);
});

test("final storage policies prevent anonymous reads and keep cleanup server-side", () => {
  assert.doesNotMatch(schema, /create policy "survey_files_public_read"/i);
  assert.doesNotMatch(schema, /create policy "survey_files_public_delete"/i);
  assert.match(schema, /create or replace function public\.is_survey_file_referenced/i);
  assert.match(schema, /grant execute on function public\.is_survey_file_referenced\(text\) to service_role/i);
  assert.match(securityHardeningMigration, /values \('survey-files', 'survey-files', false, 10485760\)/i);
  assert.match(securityFollowupMigration, /drop policy if exists "survey files read anon" on storage\.objects/i);
  assert.match(securityFollowupMigration, /drop policy if exists "survey files upload authenticated" on storage\.objects/i);
});

test("storage deletes are limited to the uploader's unreferenced object", () => {
  const deleteHelper = getFunctionDefinition("can_delete_survey_file");
  const deletePolicy = getPolicyDefinition("survey_files_authenticated_delete");

  assert.match(deleteHelper, /path_parts\[1\] <> auth\.uid\(\)::text/i);
  assert.match(deleteHelper, /not exists[\s\S]*public\.response_file_references/i);
  assert.match(deletePolicy, /public\.can_delete_survey_file\(name\)/i);
  assert.doesNotMatch(deletePolicy, /can_read_survey_file/i);
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
  assert.match(ensureLimit, /update public\.forms f[\s\S]*?set responses_count = f\.responses_count \+ 1/i);
  assert.match(ensureLimit, /f\.responses_count < least\(coalesce\(f\.max_responses, 100000\), 100000\)/i);

  const incrementCount = getFunctionDefinition("increment_form_response_count");
  assert.doesNotMatch(incrementCount, /set responses_count/i);
  assert.match(incrementCount, /set is_public = false/i);
  assert.match(incrementCount, /coalesce\(f\.max_responses, 100000\)/i);
  assert.match(schema, /responses_form_count_increment\s+after insert on public\.responses/i);
  assert.match(
    schema,
    /create or replace trigger responses_form_count_decrement\s+after delete on public\.responses\s+for each row execute procedure public\.decrement_form_response_count\(\);/i,
  );
});

test("response submission is limited to one response per browser and remains idempotent", () => {
  assert.match(schema, /submission_id uuid not null default gen_random_uuid\(\)/i);
  assert.match(schema, /create unique index idx_responses_form_submission_id on public\.responses\(form_id, submission_id\)/i);
  assert.match(schema, /browser_id uuid/i);
  assert.match(schema, /create unique index idx_responses_form_browser_id on public\.responses\(form_id, browser_id\) where browser_id is not null/i);
  const submitFunction = getFunctionDefinition("submit_form_response");
  assert.match(submitFunction, /pg_advisory_xact_lock/i);
  assert.match(submitFunction, /r\.browser_id = p_browser_id/i);
  assert.match(submitFunction, /'already_submitted'::text/i);
  assert.match(responseManagementMigration, /revoke insert on table public\.responses from anon, authenticated/i);
  const responseStatusFunction = getFunctionDefinition("get_form_response_status");
  assert.match(responseStatusFunction, /r\.browser_id = p_browser_id/i);
  assert.doesNotMatch(responseStatusFunction, /insert into public\.responses/i);
});

test("answered form schemas are immutable and response editing is server-authorized", () => {
  assert.match(schema, /allow_response_editing boolean not null default false/i);
  const schemaGuard = getFunctionDefinition("prevent_answered_form_schema_update");
  assert.match(schemaGuard, /old\.responses_count > 0/i);
  assert.match(schemaGuard, /new\.schema is distinct from old\.schema/i);
  assert.match(schemaGuard, /new\.organization_types is distinct from old\.organization_types/i);
  const updateResponse = getFunctionDefinition("update_form_response");
  assert.match(updateResponse, /not target_form\.allow_response_editing/i);
  assert.match(updateResponse, /r\.browser_id = p_browser_id/i);
  assert.match(responseManagementMigration, /forms_prevent_answered_schema_update/i);
});

test("organization directory is admin-managed and exposes only selectable fields to public forms", () => {
  assert.match(schema, /create table public\.education_organizations/i);
  assert.match(schema, /organization_type in \('school', 'kindergarten', 'odo', 'udod'\)/i);
  assert.match(schema, /organization_type = 'udod' and number is null/i);
  assert.match(schema, /organization_type <> 'udod'\s+and number is not null\s+and length\(btrim\(number\)\) between 1 and 40/i);
  assert.match(schema, /organization_types text\[\] not null default array\['school', 'kindergarten'\]/i);
  const selectPolicy = getPolicyDefinition("education_organizations_select");
  const writePolicy = getPolicyDefinition("education_organizations_admin_write");
  assert.match(selectPolicy, /to authenticated/i);
  assert.match(writePolicy, /public\.request_role\(\)\) = 'admin'/i);
  const publicList = getFunctionDefinition("list_form_organizations");
  assert.match(publicList, /returns table \(\s*id uuid,\s*organization_type text,\s*number text,\s*alias text\s*\)/i);
  assert.doesNotMatch(publicList, /email text/i);
  assert.match(publicList, /jsonb_path_exists\(f\.schema/i);
  assert.match(organizationDirectoryMigration, /grant execute on function public\.list_form_organizations\(uuid\) to anon, authenticated, service_role/i);
});

test("forms and responses are published to realtime", () => {
  assert.match(schema, /alter publication supabase_realtime add table public\.forms;/i);
  assert.match(schema, /alter publication supabase_realtime add table public\.responses;/i);
});

test("list and search indexes support stable paginated reads", () => {
  assert.match(schema, /create schema if not exists extensions;/i);
  assert.match(schema, /create extension if not exists "pg_trgm" with schema extensions;/i);
  assert.match(schema, /alter extension "pg_trgm" set schema extensions;/i);
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
