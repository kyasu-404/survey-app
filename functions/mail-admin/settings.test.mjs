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
  const Deno = { serve: fn => { handler = fn; }, env: { get: name => name.includes("ORIGINS") ? undefined : "configured" } };
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
  for (const allowInvalidCertificate of [true, false]) {
    const saved = await app.request({ ...draft, allowInvalidCertificate });
    assert.equal(saved.status, 200);
    assert.equal(saved.body.settings.allowInvalidCertificate, allowInvalidCertificate);
    assert.equal(app.writes.at(-1).allow_invalid_certificate, allowInvalidCertificate);
    assert.equal(app.writes.at(-1).password_encrypted, original.password_encrypted);
    assert.doesNotMatch(JSON.stringify(saved.body), /existing-encrypted-password|password_encrypted/);
    const loaded = await app.request({ action: "get-settings" });
    assert.equal(loaded.body.settings.allowInvalidCertificate, allowInvalidCertificate);
  }
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
