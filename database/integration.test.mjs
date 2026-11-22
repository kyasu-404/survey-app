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
  "create table storage.objects(id uuid default gen_random_uuid() primary key,bucket_id text references storage.buckets(id),name text,owner uuid,metadata jsonb,user_metadata jsonb,created_at timestamptz default now(),updated_at timestamptz default now(),version text);",
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

async function checkAutomationQueueUpgrade(db, migration, owner, form) {
  const rule = randomUUID(), run = randomUUID(), pending = randomUUID(), reminder = randomUUID();
  const legacyAction = {
    recipients: ["fixed@example.invalid"], recipientPath: ["contact"],
    subject: "Migration fixture", body: "Migration fixture", mode: "summary",
  };
  await db.query("begin");
  try {
    await db.query(`
      insert into public.automation_rules(id,user_id,form_id,name,event_type,match_mode,conditions,action_config)
      values($1,$2,$3,'Legacy rule','response_received','all','[]',$4)
    `, [rule, owner, form, legacyAction]);
    await db.query(`
      insert into public.automation_runs(id,rule_id,form_id,form_title,event_version,delivery_version,event_key,status,recipient_count)
      values($1,$3,$4,'Migration fixture',1,1,'queued-fixture','queued',2),
            ($2,$3,$4,'Migration fixture',1,1,'pending-fixture','pending',0)
    `, [run, pending, rule, form]);
    await db.query("insert into survey_automation.payloads values($1,$2)", [pending, { actionType: "email", action: legacyAction }]);
    await db.query(`
      insert into public.mail_batches(id,kind,form_id,created_by,total_count)
      values($1,'automation',$3,$4,2),($2,'reminder',$3,$4,1)
    `, [run, reminder, form, owner]);
    await db.query(`
      insert into public.mail_queue(batch_id,form_id,recipient_email,recipient_name,subject,body_text,
        status,attempts,locked_at,locked_by,automation_run_id)
      values($1,$3,'legacy-queued@example.invalid','Queued','Fixture','Fixture','queued',0,null,null,$1),
            ($1,$3,'legacy-claimed@example.invalid','Claimed','Fixture','Fixture','processing',1,now(),'worker-fixture',$1),
            ($2,$3,'ordinary@example.invalid','Ordinary','Fixture','Fixture','queued',0,null,null,null)
    `, [run, reminder, form]);

    await db.query(migration.trim().replace(/^begin;\s*/i, "").replace(/\s*commit;$/i, ""));
    const jobs = await db.query("select recipient_name,status from public.mail_queue where batch_id in ($1,$2) order by recipient_name", [run, reminder]);
    assert.deepEqual(jobs.rows, [
      { recipient_name: "Claimed", status: "processing" },
      { recipient_name: "Ordinary", status: "queued" },
      { recipient_name: "Queued", status: "failed" },
    ]);
    assert.equal((await db.query("select enabled from public.automation_rules where id=$1", [rule])).rows[0].enabled, false);
    assert.deepEqual((await db.query("select sent_count,failed_count,cancelled_count from public.automation_runs where id=$1", [run])).rows[0],
      { sent_count: 0, failed_count: 0, cancelled_count: 1 });
    await db.query("select public.process_automations('https://forms.example.invalid',50)");
    assert.equal((await db.query("select status from public.automation_runs where id=$1", [pending])).rows[0].status, "cancelled");
    assert.equal((await db.query("select 1 from public.mail_queue where automation_run_id=$1", [pending])).rowCount, 0);
  } finally {
    await db.query("rollback");
  }
}

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
    const reviewMigration = await source("./migrations/202611101200_review_corrections.sql");
    const followupMigrations = await Promise.all([
      "202611111200_counter_update_costs.sql", "202611111230_public_form_links.sql",
      "202611111300_upload_type_policy.sql",
      "202611131200_smtp_certificate_policy.sql",
      "202611182030_response_upload_size.sql",
    ].map(name => source("./migrations/" + name)));
    const automationMigration = await source("./migrations/202611221200_automations_notifications.sql");
    const announcementMigration = await source("./migrations/202611221300_announcements.sql");
    const automationReviewMigration = await source("./migrations/202611221400_automation_review_fixes.sql");
    const announcementReviewMigration = await source("./migrations/202611221410_announcement_review_fixes.sql");
    for (const upgrade of [false, true]) {
      const database = "survey_personal_check_" + randomUUID().replaceAll("-", "");
      await admin.query("create database " + database + " template template0"); databases.push(database);
      const db = await connect(database);
      const priorSchema = upgrade && process.env.SURVEY_TEST_PREVIOUS_SCHEMA ? await readFile(process.env.SURVEY_TEST_PREVIOUS_SCHEMA, "utf8") : null;
      const bootstrap = upgrade
        ? priorSchema ?? schema.split("-- Automations and personal notifications\n")[0] + "commit;\n"
        : schema;
      await db.query(infra + bootstrap);
      if (upgrade) {
        // Exercise replacement over existing data and legacy column ACLs.
        const owner = randomUUID(), form = randomUUID();
        await db.query("insert into auth.users(id,email) values($1,'upgrade@example.invalid')", [owner]);
        await db.query("insert into public.forms(id,title,author_id,form_type,form_reason,schema) values($1,'Migration fixture',$2,'anketa','plan','{\"pages\":[]}')", [form, owner]);
        if (!priorSchema) await db.query("drop trigger responses_prepare_files on public.responses; drop table public.survey_file_deletion_claims");
        const needsOctoberMigration = !(await db.query("select to_regclass('public.survey_file_deletion_claims') is not null present")).rows[0].present;
        if (needsOctoberMigration) {
          await db.query("grant insert(form_id,submission_id,data) on public.responses to anon,authenticated");
          await db.query(migration);
        }
        await db.query(reviewMigration);
        // Rehearse the SMTP migration over a populated pre-option settings row.
        if (!priorSchema) await db.query("alter table public.mail_settings drop column allow_invalid_certificate");
        await db.query("insert into public.mail_settings(host,port,username,password_encrypted,from_email,from_name) values('smtp.example.test',465,'test','migration-encrypted-password','test@example.test','Migration fixture')");
        // Include legacy column ACLs; a table-level REVOKE alone is insufficient.
        await db.query("grant select(id,author_name) on public.forms to anon");
        for (const sql of followupMigrations) await db.query(sql);
        const smtp = (await db.query("select allow_invalid_certificate,password_encrypted from public.mail_settings where id=1")).rows[0];
        assert.equal(smtp.allow_invalid_certificate, false);
        assert.equal(smtp.password_encrypted, "migration-encrypted-password");
        await db.query("delete from public.mail_settings where id=1");
        if (!(await db.query("select to_regclass('public.automation_rules') is not null present")).rows[0].present) {
          await db.query(automationMigration);
        }
        if (!(await db.query("select to_regnamespace('survey_announcements') is not null present")).rows[0].present) {
          await db.query(announcementMigration);
        }
        await checkAutomationQueueUpgrade(db, automationReviewMigration, owner, form);
        await db.query(automationReviewMigration);
        await db.query(announcementReviewMigration);
        assert.equal((await db.query("select count(*)::int n from public.forms where id=$1", [form])).rows[0].n, 1);
      }
      await runPsql(database, "./tests/final_review_fixes.sql");
      await runPsql(database, "./tests/review_corrections.sql");
      await runPsql(database, "./tests/public_form_access.sql");
      await runPsql(database, "./tests/counter_update_costs.sql");
      await runPsql(database, "./tests/upload_type_policy.sql");
      await runPsql(database, "./tests/upload_size_limit.sql");
      await runPsql(database, "./tests/smtp_certificate_policy.sql");
      await runPsql(database, "./tests/automations.sql");
      await runPsql(database, "./tests/automation_regressions.sql");
      await runPsql(database, "./tests/automation_review_fixes.sql");
      await runPsql(database, "./tests/announcements.sql");
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

      // Deletion waits for an in-flight response edit, then captures its new paths.
      const editedPath = await reserve();
      await a.query("begin");
      await a.query("update public.responses set data=$2 where form_id=$1", [form, { file: [{ content: editedPath }] }]);
      const waitForRowLock = async () => {
        const deadline = Date.now() + 5000;
        while (Date.now() < deadline) {
          if ((await db.query("select wait_event_type='Lock' blocked from pg_stat_activity where pid=$1", [pid])).rows[0]?.blocked) return;
          await new Promise(resolve => setTimeout(resolve, 20));
        }
        throw new Error("The competing transaction did not wait for the row lock");
      };
      pending = b.query("select public.delete_form_with_files($1,$2) result", [form,owner]).then(result => ({result}), error => ({error}));
      await waitForRowLock(); await a.query("commit");
      const deletion = await pending;
      assert.ifError(deletion.error);
      assert.deepEqual(deletion.result.rows[0].result.objectPaths, [editedPath]);

      // An edit during catch-up must update the subtotal of the page the worker just committed.
      const countedForm = randomUUID();
      const countedResponse = randomUUID();
      await db.query("insert into public.forms(id,title,author_id,form_type,form_reason,schema) values($1,'Concurrent threshold',$2,'anketa','plan',$3)",
        [countedForm, owner, { pages: [{ elements: [{ type: "text", name: "amount" }] }] }]);
      await db.query("insert into public.responses(id,form_id,data,created_at) values($1,$2,'{\"amount\":\"9\"}',now()-interval '2 days')",
        [countedResponse, countedForm]);
      await db.query("insert into public.responses(form_id,data,created_at) select $1,'{\"amount\":\"0\"}', now()-interval '1 day' from generate_series(1,1000)", [countedForm]);
      await db.query("begin");
      await db.query("select set_config('request.jwt.claim.sub',$1,true)", [owner]);
      const conditions = JSON.stringify([{ path: ["amount"], op: "gt", value: 5 }]);
      const action = { recipients: ["owner@example.invalid"], subject: "Count", body: "Count", mode: "summary" };
      const { rows: [{ rule }] } = await db.query("select public.save_automation_rule(null,$1,'Count','',true,'matching_count',2,null,null,'all',$2,$3) rule",
        [countedForm, conditions, action]);
      await db.query("commit");
      const submitMatch = () => db.query("select public.submit_form_response($1,$2,$3,$4)", [countedForm, randomUUID(), randomUUID(), { amount: "9" }]);
      await submitMatch();
      await a.query("begin");
      await a.query("select public.process_automations('https://example.invalid',50)");
      pending = b.query("update public.responses set data='{\"amount\":\"0\"}' where id=$1", [countedResponse]).then(result => ({result}), error => ({error}));
      await waitForRowLock(); await a.query("commit");
      assert.ifError((await pending).error);
      await db.query("select public.process_automations('https://example.invalid',50)");
      const runs = async () => (await db.query("select count(*)::int as n from public.automation_runs where rule_id=$1", [rule])).rows[0].n;
      assert.equal(await runs(), 0, "An edited historical response was still counted");
      await submitMatch();
      assert.equal(await runs(), 1, "The ready count missed a subsequent qualifying answer");

      // Repeated and opposing status requests serialize both Auth and profile.
      const target = randomUUID();
      await db.query("insert into auth.users(id,email) values($1,'status@example.invalid')", [target]);
      await db.query("update public.profiles set role='admin' where id=$1", [owner]);
      for (const [first, second] of [[true,true], [false,false], [true,false], [false,true]]) {
        await a.query("begin");
        await a.query("select public.set_employee_disabled($1,$2,$3)", [target,first,owner]);
        pending = b.query("select public.set_employee_disabled($1,$2,$3)", [target,second,owner]).then(result => ({result}), error => ({error}));
        await waitForRowLock(); await a.query("commit");
        assert.ifError((await pending).error);
        const state = (await db.query("select p.is_disabled,coalesce(u.banned_until>clock_timestamp(),false) banned from public.profiles p join auth.users u on u.id=p.id where p.id=$1", [target])).rows[0];
        assert.deepEqual(state, { is_disabled: second, banned: second });
      }
    }
  } finally {
    for (const client of clients) { await client.query("rollback").catch(()=>{}); await client.end().catch(()=>{}); }
    for (const database of databases) await admin.query("drop database " + database + " with (force)");
    await admin.end();
  }
});
