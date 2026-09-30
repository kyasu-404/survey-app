import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { webcrypto } from "node:crypto";
import test from "node:test";
import ts from "../../frontend/node_modules/typescript/lib/typescript.js";
import * as content from "./mailContent.mjs";

// Execute the actual Edge handler with a database boundary double: no live mail or credentials.
const source = ts.transpileModule(readFileSync(new URL("./index.ts", import.meta.url), "utf8").replace(/^import .*;\n/gm, ""), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const userId = "10000000-0000-4000-8000-000000000001";
const formId = "20000000-0000-4000-8000-000000000001";
const organizations = [1, 2].map(n => ({ id: `40000000-0000-4000-8000-${String(n).padStart(12, "0")}`, alias: "Школа", number: String(n), email: `org${n}@test.ru`, organization_type: "school", token: `token-${n}` }));
function setup({ owner = true, role = "user", enabled = true, personal = true, recipients = organizations } = {}) {
  let handler;
  const calls = [];
  const client = {
    auth: { getUser: async () => ({ data: { user: { id: userId } } }) },
    from(table) {
      const row = table === "profiles" ? { id: userId, role, is_disabled: false }
        : table === "forms" ? { id: formId, title: "Отчёт", deadline_at: null, author_id: owner ? userId : "another" }
        : table === "mail_settings" ? { enabled } : null;
      return { select() { return this; }, eq() { return this; }, single: async () => ({ data: row }), maybeSingle: async () => ({ data: row }) };
    },
    async rpc(name, args) { calls.push({ name, args }); return { data: name === "prepare_form_mail_recipients" ? { personal, recipients } : null }; },
  };
  const Deno = { serve: fn => { handler = fn; }, env: { get: name => name === "PUBLIC_APP_URL" ? "https://forms.test" : name.includes("ORIGINS") ? undefined : "configured" } };
  const names = Object.keys(content);
  new Function("Deno", "createClient", "crypto", "console", ...names, source)(Deno, () => client, webcrypto, { info() {}, error() {} }, ...names.map(n => content[n]));
  return { calls, async request(payload, authenticated = true) {
    const response = await handler(new Request("https://api.test/mail-admin", { method: "POST", headers: authenticated ? { Authorization: "Bearer test" } : {}, body: JSON.stringify({ formId, ...payload }) }));
    return { status: response.status, body: await response.json() };
  } };
}
const draft = { personal: true, organizationIds: [organizations[1].id], template: { subject: "Для {Организация}", bodyText: "Здравствуйте!\n{Ссылка}" } };

test("prepare returns editable defaults and eligible recipients even when SMTP is off, without enqueuing", async () => {
  const app = setup({ enabled: false });
  const { status, body } = await app.request({ action: "prepare-mail", kind: "invitation" });
  assert.equal(status, 200); assert.equal(body.smtpEnabled, false); assert.equal(body.recipients.length, 2);
  assert.equal(body.recipients[0].token, undefined); assert.ok(body.template.bodyText.includes("{Ссылка}"));
  assert.deepEqual(app.calls.map(c => c.name), ["prepare_form_mail_recipients"]);
});

test("server preview and queued message match, selection and custom content reach SMTP queue", async () => {
  const app = setup();
  const preview = await app.request({ action: "preview-mail", kind: "invitation", ...draft });
  assert.equal(preview.status, 200); assert.equal(preview.body.recipientCount, 1);
  assert.match(preview.body.message.bodyText, /#personal=token-2$/);
  assert.ok(!app.calls.some(call => call.name === "enqueue_form_mail_batch"));
  const result = await app.request({ action: "queue-invitations", ...draft });
  assert.equal(result.status, 202); assert.equal(result.body.queuedCount, 1);
  const enqueue = app.calls.find(call => call.name === "enqueue_form_mail_batch").args;
  assert.equal(enqueue.p_jobs[0].body_text, preview.body.message.bodyText);
  assert.equal(enqueue.p_jobs[0].subject, "Для Школа № 2");
  assert.equal(enqueue.p_jobs[0].organization_id, organizations[1].id);
  assert.equal(enqueue.p_personal, true);
});

test("owner permission and authentication protect recipient data and queue", async () => {
  const app = setup({ owner: false });
  assert.equal((await app.request({ action: "prepare-mail", kind: "invitation" })).status, 403);
  assert.equal((await app.request({ action: "queue-invitations", ...draft }, false)).status, 401);
  assert.equal(app.calls.length, 0);
});

test("rejects stale recipients, changed link mode and invalid templates without queue mutation", async () => {
  for (const [options, payload, expected] of [
    [{ recipients: organizations.slice(0, 1) }, draft, 400],
    [{ personal: false }, draft, 409],
    [{}, { ...draft, template: { subject: "Без ссылки", bodyText: "Текст" } }, 400],
    [{ enabled: false }, draft, 409],
  ]) {
    const app = setup(options);
    assert.equal((await app.request({ action: "queue-reminders", ...payload })).status, expected);
    assert.ok(!app.calls.some(call => call.name === "enqueue_form_mail_batch"));
  }
});

test("common-link reminders and legacy requests still work", async () => {
  const app = setup({ personal: false });
  assert.equal((await app.request({ action: "queue-reminders", ...draft, personal: false })).status, 202);
  assert.ok(!app.calls.at(-1).args.p_jobs[0].body_text.includes("#personal="));
  assert.equal((await app.request({ action: "queue-reminders" })).body.queuedCount, 2);
});

test("invalid prepare kinds and test emails with SMTP off return client errors", async () => {
  const app = setup({ enabled: false });
  assert.equal((await app.request({ action: "prepare-mail", kind: "invalid" })).status, 400);
  // A regular user is disallowed before the SMTP check; no undefined compose variables execute.
  assert.equal((await app.request({ action: "queue-test", recipientEmail: "user@test.ru" })).status, 403);
});


test("a non-author administrator cannot prepare, preview or queue form mail", async () => {
  const app=setup({owner:false,role:"admin"});
  for (const action of ["prepare-mail","preview-mail","queue-invitations","queue-reminders"]) {
    assert.equal((await app.request({action,kind:"invitation",...draft})).status,403);
  }
  assert.equal(app.calls.length,0);
});
