import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";

const require = createRequire(new URL("../office-service/package.json", import.meta.url));
const { Client } = require("pg");
const adminUrl = process.env.SURVEY_TEST_DATABASE_URL;
const infra = [
  "create schema auth;",
  "create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',banned_until timestamptz);",
  "create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;",
  "grant usage on schema auth to anon,authenticated,service_role;",
  "create schema storage;",
  "create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);",
  "create table storage.objects(id uuid default gen_random_uuid() primary key,bucket_id text references storage.buckets(id),name text,owner uuid,metadata jsonb,created_at timestamptz default now(),updated_at timestamptz default now(),version text);",
  "alter table storage.objects enable row level security;",
  "grant usage on schema storage to anon,authenticated,service_role;",
  "grant all on storage.buckets,storage.objects to service_role;",
  "grant select,insert,update,delete on storage.objects to anon,authenticated;",
  "create publication supabase_realtime;",
].join("\n");
const source = path => readFile(new URL(path, import.meta.url), "utf8");
const runPsql = async (database, path) => {
  const url = new URL(adminUrl);
  try {
    await promisify(execFile)("psql", ["--no-psqlrc", "--set=ON_ERROR_STOP=1", "--file", new URL(path, import.meta.url).pathname], {
      env: { ...process.env, PGHOST: url.hostname, PGPORT: url.port || "5432", PGUSER: decodeURIComponent(url.username), PGPASSWORD: decodeURIComponent(url.password), PGDATABASE: database },
      timeout: 180000,
    });
  } catch (error) { throw new Error(`${path}: ${error.stderr || error.message} (${error.code ?? "unknown"})`); }
};

test("PostgreSQL: bootstrap, additive migration and attachment/deletion contention", { skip: !adminUrl, timeout: 300000 }, async () => {
  const admin = new Client({ connectionString: adminUrl });
  await admin.connect();
  const databases = [], clients = [];
  const connect = async database => {
    const url = new URL(adminUrl); url.pathname = "/" + database;
    const client = new Client({ connectionString: url.href });
    await client.connect(); clients.push(client); return client;
  };
  try {
    for (const role of ["anon", "authenticated", "service_role"]) {
      const { rowCount } = await admin.query("select 1 from pg_roles where rolname=$1", [role]);
      if (!rowCount) await admin.query("create role " + role + " nologin " + (role === "service_role" ? "bypassrls" : ""));
    }
    const schema = await source("./supabase_schema.sql");
    const migration = await source("./migrations/202610291200_final_review_fixes.sql");
    for (const upgrade of [false, true]) {
      const database = "survey_personal_check_" + randomUUID().replaceAll("-", "");
      await admin.query("create database " + database + " template template0"); databases.push(database);
      const db = await connect(database);
      const priorSchema = upgrade && process.env.SURVEY_TEST_PREVIOUS_SCHEMA ? await readFile(process.env.SURVEY_TEST_PREVIOUS_SCHEMA, "utf8") : null;
      await db.query(infra + (priorSchema ?? schema));
      if (upgrade) {
        // Exercise replacement over existing data and legacy column ACLs.
        const owner = randomUUID(), form = randomUUID();
        await db.query("insert into auth.users(id,email) values($1,'upgrade@example.invalid')", [owner]);
        await db.query("insert into public.forms(id,title,author_id,form_type,form_reason,schema) values($1,'Migration fixture',$2,'anketa','plan','{\"pages\":[]}')", [form, owner]);
        if (!priorSchema) await db.query("drop trigger responses_prepare_files on public.responses; drop table public.survey_file_deletion_claims");
        await db.query("grant insert(form_id,submission_id,data) on public.responses to anon,authenticated");
        await db.query(migration);
        assert.equal((await db.query("select count(*)::int n from public.forms where id=$1", [form])).rows[0].n, 1);
      }
      await runPsql(database, "./tests/final_review_fixes.sql");
      for (const path of ["./tests/response_scope_validation.sql", "./tests/nested_personal_organizations.sql", "./tests/response_comments.sql", "./tests/response_attachment_ownership.sql", "./tests/code_review_fixes.sql", ...(process.env.SURVEY_TEST_SCALE === "1" ? ["./tests/review_fixes.sql"] : []), "./tests/office_orphan_cleanup.sql", "./site_settings.test.sql", "./personal_links.test.sql", "./tests/restore_response_uploads.sql"]) {
        await runPsql(database, path);
      }
      if (upgrade) continue;
      const a = await connect(database), b = await connect(database);
      const owner = randomUUID(), form = randomUUID(), browser = randomUUID();
      await db.query("insert into auth.users(id,email) values($1,'race@example.invalid')", [owner]);
      await db.query("insert into public.forms(id,title,author_id,form_type,form_reason,schema) values($1,'Race fixture',$2,'anketa','plan','{\"pages\":[{\"elements\":[{\"type\":\"file\",\"name\":\"file\"}]}]}')", [form, owner]);
      const reserve = async () => {
        const path = (await db.query("select public.reserve_survey_upload($1,$2,$3,1,'.txt') path", [form,browser,"c".repeat(64)])).rows[0].path;
        await db.query("insert into storage.objects(bucket_id,name,metadata) values('survey-files',$1,'{\"size\":1}')", [path]);
        return path;
      };
      const pid = (await b.query("select pg_backend_pid() pid")).rows[0].pid;
      const waitUntilBlocked = async () => {
        const deadline = Date.now()+5000;
        while (Date.now()<deadline) {
          if ((await db.query("select exists(select from pg_locks where pid=$1 and locktype='advisory' and not granted) blocked", [pid])).rows[0].blocked) return;
          await new Promise(resolve => setTimeout(resolve, 20));
        }
        throw new Error("The competing transaction did not block on the object lock");
      };
      let path = await reserve();
      await a.query("begin");
      await a.query("select public.claim_survey_file_deletions(array[$1])", [path]);
      let pending = b.query("select * from public.submit_form_response($1,$2,$3,$4)", [form,browser,randomUUID(),{file:[{content:path}]}])
        .then(result => ({result}), error => ({error}));
      await waitUntilBlocked(); await a.query("commit");
      assert.equal((await pending).error?.code, "22023", "An attachment committed after deletion had been claimed");
      path = await reserve();
      await a.query("begin");
      await a.query("select * from public.submit_form_response($1,$2,$3,$4)", [form,browser,randomUUID(),{file:[{content:path}]}]);
      pending = b.query("select public.claim_survey_file_deletions(array[$1]) paths", [path]).then(result => ({result}), error => ({error}));
      await waitUntilBlocked(); await a.query("commit");
      assert.deepEqual((await pending).result.rows[0].paths, [], "A committed attachment was claimed for deletion");
    }
  } finally {
    for (const client of clients) { await client.query("rollback").catch(()=>{}); await client.end().catch(()=>{}); }
    for (const database of databases) await admin.query("drop database " + database + " with (force)");
    await admin.end();
  }
});
