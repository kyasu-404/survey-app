import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { webcrypto } from "node:crypto";
import test from "node:test";
import ts from "../../frontend/node_modules/typescript/lib/typescript.js";
import * as content from "./mailContent.mjs";

const source = ts.transpileModule(readFileSync(new URL("./index.ts", import.meta.url), "utf8").replace(/^import .*;\n/gm, ""), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText;
const original = {
  id: 1, enabled: true, host: "smtp.example.test", port: 465, ssl_mode: "tls",
  username: "test", password_encrypted: "existing-encrypted-password", from_email: "test@example.test",
  from_name: "Формы", reply_to: null, updated_at: "2026-11-13T00:00:00Z",
};
const draft = {
  action: "save-settings", enabled: true, host: "smtp.example.test", port: 465, sslMode: "tls",
  username: "test", password: "", fromEmail: "test@example.test", fromName: "Формы", replyTo: "",
};

function setup({ role = "admin", stored = original } = {}) {
  let handler, row = { ...stored };
  const writes = [];
  const client = {
    auth: { getUser: async () => ({ data: { user: { id: "admin-id" } } }) },
    from(table) {
      return {
        select() { return this; }, eq() { return this; },
        upsert(value) { writes.push(value); row = { ...row, ...value }; return this; },
        single: async () => ({ data: table === "profiles" ? { id: "admin-id", role, is_disabled: false } : row }),
        maybeSingle: async () => ({ data: row }),
      };
    },
  };
  const Deno = { serve: fn => { handler = fn; }, env: { get(name) {
    if (name === "MAIL_SETTINGS_ENCRYPTION_KEY") return Buffer.alloc(32).toString("base64");
    if (name.includes("ORIGINS") || name === "SMTP_ALLOWED_PRIVATE_HOSTS") return undefined;
    return "configured";
  } } };
  const names = Object.keys(content);
  new Function("Deno", "createClient", "crypto", "console", ...names, source)(
    Deno, () => client, webcrypto, { info() {}, error() {} }, ...names.map(name => content[name]),
  );
  return { writes, async request(payload) {
    const response = await handler(new Request("https://api.test/mail-admin", {
      method: "POST", headers: { Authorization: "Bearer test" }, body: JSON.stringify(payload),
    }));
    return { status: response.status, body: await response.json() };
  } };
}

test("SMTP certificate exceptions default off and round-trip through admin settings without exposing credentials", async () => {
  const app = setup();
  const initial = await app.request({ action: "get-settings" });
  assert.equal(initial.status, 200);
  assert.equal(initial.body.settings.allowInvalidCertificate, false);
  const rejected = await app.request({ ...draft, allowInvalidCertificate: true });
  assert.equal(rejected.status, 400);
  assert.equal(app.writes.length, 0);

  const exceptional = await app.request({ ...draft, allowInvalidCertificate: true, password: "new-test-password" });
  assert.equal(exceptional.status, 200);
  assert.equal(exceptional.body.settings.allowInvalidCertificate, true);
  const encrypted = app.writes.at(-1).password_encrypted;
  assert.match(encrypted, /^v2:/);

  const strict = await app.request({ ...draft, allowInvalidCertificate: false });
  assert.equal(strict.status, 200);
  assert.equal(strict.body.settings.allowInvalidCertificate, false);
  assert.equal(app.writes.at(-1).password_encrypted, encrypted);
  assert.doesNotMatch(JSON.stringify(strict.body), /password_encrypted|new-test-password/);
  const loaded = await app.request({ action: "get-settings" });
  assert.equal(loaded.body.settings.allowInvalidCertificate, false);
});

test("old clients preserve the saved certificate policy when omitting the new field", async () => {
  for (const allow_invalid_certificate of [undefined, true, false]) {
    const app = setup({ stored: { ...original, allow_invalid_certificate } });
    assert.equal((await app.request(draft)).status, 200);
    assert.equal(app.writes[0].allow_invalid_certificate, allow_invalid_certificate === true);
  }
});

test("SMTP certificate exceptions reject malformed values and remain administrator-only", async () => {
  for (const allowInvalidCertificate of [null, "true", "false", 1, {}, []]) {
    const app = setup();
    assert.equal((await app.request({ ...draft, allowInvalidCertificate })).status, 400);
    assert.equal(app.writes.length, 0);
  }
  const app = setup({ role: "user" });
  assert.equal((await app.request({ ...draft, allowInvalidCertificate: true })).status, 403);
  assert.equal((await app.request({ action: "get-settings" })).status, 403);
  assert.equal(app.writes.length, 0);
});

test("requires SMTP password re-entry on connection target change and rejects internal/loopback hosts", async () => {
  const app = setup();
  for (const mutation of [{ host: "attacker.example.test" }, { port: 587 }, { username: "other" }, { sslMode: "starttls" }]) {
    const res = await app.request({ ...draft, ...mutation, password: "" });
    assert.equal(res.status, 400, JSON.stringify(mutation));
  }
  for (const host of ["localhost", "sub.localhost", "127.0.0.1", "0.0.0.0", "169.254.169.254", "kong", "office-service", "db"]) {
    const res = await app.request({ ...draft, host, password: "secret" });
    assert.equal(res.status, 400, host);
  }
  assert.equal((await app.request({ ...draft, enabled: "yes" })).status, 400);
  assert.equal(app.writes.length, 0);
});

test("mailContent strips control chars, clamps long subjects, and ignores prototype keys", () => {
  const longTitle = "Форма\x00\x07 " + "А".repeat(600);
  const reminder = content.buildReminderMail({ organizationName: "Школа\x01 №1", formTitle: longTitle, deadlineAt: null, formUrl: "https://forms.test/form/1" });
  const invitation = content.buildInvitationMail({ organizationName: "Школа\x01 №1", formTitle: longTitle, deadlineAt: null, formUrl: "https://forms.test/form/1" });
  assert.ok(reminder.subject.length <= 500);
  assert.ok(invitation.subject.length <= 500);
  assert.doesNotMatch(reminder.subject, /[\x00-\x1f\x7f]/);
  const rendered = content.renderMailTemplate(
    { subject: "{toString} {Название формы}", bodyText: "{constructor}\n{Ссылка}" },
    { organizationName: "Школа", formTitle: "Тест", deadlineAt: null, formUrl: "https://forms.test/form/1" },
  );
  assert.equal(rendered.subject, "{toString} Тест");
  assert.equal(rendered.bodyText, "{constructor}\nhttps://forms.test/form/1");
});
