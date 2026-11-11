import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import test from "node:test";
import { promisify } from "node:util";

const require = createRequire(new URL("../office-service/package.json", import.meta.url));
const { Client } = require("pg");
const adminUrl = process.env.SURVEY_TEST_DATABASE_URL;
const run = promisify(execFile);
const docker = (args, options = {}) => run("docker", args, { timeout: 30_000, maxBuffer: 256 * 1024, ...options });

// Only the Supabase infrastructure needed to bootstrap an empty test database.
const infrastructure = `
  create schema auth;
  create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',banned_until timestamptz);
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
  grant usage on schema auth to anon,authenticated,service_role;
  create schema storage;
  create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
  create table storage.objects(id uuid default gen_random_uuid() primary key,bucket_id text references storage.buckets(id),name text,owner uuid,metadata jsonb,user_metadata jsonb,created_at timestamptz default now(),updated_at timestamptz default now(),version text);
  alter table storage.objects enable row level security;
  grant usage on schema storage to anon,authenticated,service_role;
  grant all on storage.buckets,storage.objects to service_role;
  grant select,insert,update,delete on storage.objects to anon,authenticated;
  create publication supabase_realtime;
`;

async function findAvailablePort() {
  const guard = createServer();
  guard.listen(0, "127.0.0.1");
  await once(guard, "listening");
  const { port } = guard.address();
  await new Promise((resolve, reject) => guard.close((error) => error ? reject(error) : resolve()));
  return port;
}

test("PostgREST: anonymous public links without forms enumeration", { skip: !adminUrl, timeout: 180_000 }, async (t) => {
  const suffix = randomUUID().replaceAll("-", "");
  const database = `survey_personal_check_http_${suffix}`;
  const container = `survey-public-http-${suffix}`;
  const admin = new Client({ connectionString: adminUrl });
  const databaseUrl = new URL(adminUrl);
  databaseUrl.pathname = `/${database}`;
  let db;
  let databaseCreated = false;
  let containerCreated = false;
  let origin;

  async function stopApi() {
    if (!containerCreated) return;
    await docker(["rm", "--force", container]);
    containerCreated = false;
  }

  async function startApi() {
    const port = await findAvailablePort();
    origin = `http://127.0.0.1:${port}`;
    containerCreated = true;
    await docker([
      "run", "--detach", "--name", container, "--network", "host",
      "--env", "PGRST_DB_URI", "--env", "PGRST_DB_SCHEMAS=public", "--env", "PGRST_DB_ANON_ROLE=anon",
      "--env", "PGRST_SERVER_HOST=127.0.0.1", "--env", `PGRST_SERVER_PORT=${port}`,
      "postgrest/postgrest:v14.12",
    ], { env: { ...process.env, PGRST_DB_URI: databaseUrl.href } });
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      const { stdout } = await docker(["inspect", "--format", "{{.State.Running}}", container], { timeout: 2_000 });
      if (stdout.trim() !== "true") {
        const { stdout: logs, stderr } = await docker(["logs", container]);
        throw new Error(`Isolated PostgREST did not bind its reserved localhost port: ${logs}${stderr}`);
      }
      try {
        const response = await fetch(origin, { signal: AbortSignal.timeout(1_000) });
        await response.body?.cancel();
        if (response.ok) return;
      } catch { /* Wait only for this disposable API's startup. */ }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error("Isolated PostgREST was not ready within 30 seconds");
  }

  async function request(path, body) {
    const response = await fetch(`${origin}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(5_000),
    });
    return { status: response.status, body: await response.json() };
  }

  const owner = randomUUID();
  const publicForm = randomUUID();
  const privateForm = randomUUID();
  const expiredForm = randomUUID();
  const missingForm = randomUUID();
  const schema = { pages: [{ elements: [{ type: "text", name: "answer" }] }] };
  let storedSchema;

  async function verifyContract(label) {
    for (const selection of ["id", "*"]) {
      await t.test(`${label}: anonymous forms select=${selection} is denied over HTTP`, async () => {
        const result = await request(`/forms?select=${selection}`);
        assert.equal(result.status, 401);
        assert.equal(result.body.code, "42501");
        assert.match(result.body.message, /permission denied for table forms/i);
      });
    }
    await t.test(`${label}: known-ID RPC returns the public schema without author details`, async () => {
      const result = await request("/rpc/get_public_form", { p_form_id: publicForm });
      assert.equal(result.status, 200);
      assert.equal(result.body.id, publicForm);
      assert.equal(result.body.title, "HTTP public fixture");
      assert.deepEqual(result.body.schema, storedSchema);
      assert.equal(result.body.is_public, true);
      for (const field of ["author_id", "author_name", "author_email"]) assert.equal(Object.hasOwn(result.body, field), false);
      assert.equal(JSON.stringify(result.body).includes("private-owner@example.invalid"), false);
    });
    await t.test(`${label}: private, expired, missing and null IDs return null`, async () => {
      for (const id of [privateForm, expiredForm, missingForm, null]) {
        const result = await request("/rpc/get_public_form", { p_form_id: id });
        assert.deepEqual(result, { status: 200, body: null });
      }
    });
    await t.test(`${label}: anonymous response RPC still persists a submission`, async () => {
      const submission = randomUUID();
      const result = await request("/rpc/submit_form_response", {
        p_form_id: publicForm, p_browser_id: randomUUID(), p_submission_id: submission,
        p_data: { answer: "HTTP submission" },
      });
      assert.equal(result.status, 200);
      assert.equal(result.body.length, 1);
      assert.equal(result.body[0].status, "submitted");
      assert.deepEqual(result.body[0].response_data, { answer: "HTTP submission" });
      const persisted = await db.query("select id,form_id,data,user_id from public.responses where submission_id=$1", [submission]);
      assert.deepEqual(persisted.rows, [{ id: result.body[0].response_id, form_id: publicForm, data: { answer: "HTTP submission" }, user_id: null }]);
    });
  }

  try {
    await admin.connect();
    for (const role of ["anon", "authenticated", "service_role"]) {
      const result = await admin.query("select 1 from pg_roles where rolname=$1", [role]);
      if (!result.rowCount) await admin.query(`create role ${role} nologin ${role === "service_role" ? "bypassrls" : ""}`);
    }
    await admin.query(`create database ${database} template template0`);
    databaseCreated = true;
    db = new Client({ connectionString: databaseUrl.href });
    await db.connect();
    await db.query(infrastructure + await readFile(new URL("./supabase_schema.sql", import.meta.url), "utf8"));
    await db.query("insert into auth.users(id,email,raw_user_meta_data) values($1,'private-owner@example.invalid','{\"name\":\"Private Author\"}')", [owner]);
    await db.query(`insert into public.forms(id,title,author_id,form_type,form_reason,schema,is_public,deadline_at) values
      ($1,'HTTP public fixture',$4,'anketa','plan',$5,true,null),
      ($2,'HTTP private fixture',$4,'anketa','plan',$5,false,null),
      ($3,'HTTP expired fixture',$4,'anketa','plan',$5,true,now()-interval '1 day')`,
    [publicForm, privateForm, expiredForm, owner, schema]);
    // The normal insertion trigger assigns stable question integration IDs.
    storedSchema = (await db.query("select schema from public.forms where id=$1", [publicForm])).rows[0].schema;
    await startApi();
    await verifyContract("Fresh schema");

    await stopApi();
    await db.query(`
      grant select on public.forms to anon;
      grant select(id,author_name) on public.forms to anon;
      create policy forms_select_anon on public.forms for select to anon using (public.is_public_active_form(id));
      drop function public.get_public_form(uuid);
    `);
    await startApi();
    await t.test("legacy ACL control exposes public form IDs before migration", async () => {
      const result = await request("/forms?select=id");
      assert.deepEqual(result, { status: 200, body: [{ id: publicForm }] });
    });

    await stopApi();
    await db.query(await readFile(new URL("./migrations/202611111230_public_form_links.sql", import.meta.url), "utf8"));
    await startApi();
    await verifyContract("Additive migration");
  } finally {
    const cleanup = [];
    try { await stopApi(); } catch (error) { cleanup.push(error); }
    if (db) {
      try { await db.end(); } catch (error) { cleanup.push(error); }
    }
    if (databaseCreated) {
      try { await admin.query(`drop database ${database} with (force)`); } catch (error) { cleanup.push(error); }
    }
    try { await admin.end(); } catch (error) { cleanup.push(error); }
    if (cleanup.length) throw new AggregateError(cleanup, "Could not remove isolated public-link HTTP fixtures");
  }
});
