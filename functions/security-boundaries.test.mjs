import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { webcrypto } from "node:crypto";
import test from "node:test";
import ts from "../frontend/node_modules/typescript/lib/typescript.js";

function handlerFor(name, environment = {}, client = {}) {
  const source = readFileSync(new URL(`./${name}/index.ts`, import.meta.url), "utf8").replace(/^import .*;\n/gm, "");
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } });
  let handler;
  const env = { SUPABASE_URL: "https://api.test", SUPABASE_ANON_KEY: "anon", SUPABASE_SERVICE_ROLE_KEY: "service", ...environment };
  new Function("Deno", "createClient", "crypto", "console", compiled.outputText)(
    { env: { get: key => env[key] }, serve: callback => { handler = callback; } },
    () => client, webcrypto, { info() {}, error() {} },
  );
  return (origin, method = "OPTIONS", payload = {}, headers = {}) => handler(new Request("https://api.test/functions", {
    method, headers: { ...(origin === null ? {} : { Origin: origin }), ...headers },
    ...(method === "POST" ? { body: JSON.stringify(payload) } : {}),
  }));
}

for (const [name, key] of [["form-admin", "FORM_ADMIN_ALLOWED_ORIGINS"], ["user-admin", "USER_ADMIN_ALLOWED_ORIGINS"],
  ["mail-admin", "MAIL_ADMIN_ALLOWED_ORIGINS"], ["app-settings", "MAIL_ADMIN_ALLOWED_ORIGINS"]]) {
  test(`${name}: explicit origins are authoritative for preflight and POST`, async () => {
    const request = handlerFor(name, { [key]: " https://forms.test , http://10.0.0.2:5173 " });
    for (const origin of ["http://172.28.209.57:5173", "http://localhost:5173", "http://127.0.0.1:8000", "https://attacker.test"]) {
      for (const method of ["OPTIONS", "POST"]) {
        const response = await request(origin, method);
        assert.equal(response.status, 403, `${origin} ${method}`);
        assert.equal(response.headers.get("Access-Control-Allow-Origin"), null);
      }
    }
    for (const origin of ["https://forms.test", "http://10.0.0.2:5173", null]) {
      const response = await request(origin);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("Access-Control-Allow-Origin"), origin);
    }
    assert.equal((await handlerFor(name, { [key]: " , " })("http://localhost:5173")).status, 403);
  });

  test(`${name}: default development accepts actual LAN addresses and rejects lookalike DNS names`, async () => {
    const request = handlerFor(name);
    for (const origin of ["http://172.28.209.57:5173", "http://10.0.0.2:3000", "https://192.168.1.2:4173", "http://localhost:8000", "http://[::1]:5173"]) {
      assert.equal((await request(origin)).status, 200, origin);
      assert.equal((await request(origin, "POST")).status, 401, `authentication still required: ${origin}`);
    }
    for (const origin of ["http://10.attacker.example:5173", "https://192.168.attacker.example:8000", "http://172.16.attacker.example:3000",
      "http://172.15.1.2:5173", "http://172.32.1.2:5173", "http://8.8.8.8:5173", "http://10.0.0.2:8080", "http://10.0.0.2:5173/path", "null"]) {
      assert.equal((await request(origin)).status, 403, origin);
    }
  });
}

const formId = "b5000000-0000-4000-8000-000000000001";
const browserId = "d5000000-0000-4000-8000-000000000001";
const path = `public/${formId}/c5000000-0000-4000-8000-000000000001.txt`;
function deletionClient({ allowed = true, ownershipError = null, referenced = false, active = true } = {}) {
  const effects = [];
  return { effects, client: {
    rpc: async (name, args) => {
      effects.push({ name, args });
      return name === "can_restore_survey_upload" ? { data: allowed, error: ownershipError }
        : { data: referenced ? [] : [path] };
    },
    from: name => ({
      select() { return this; }, eq() { return this; }, or() { return this; },
      maybeSingle: async () => ({ data: active ? { id: formId } : null }),
      update: value => { effects.push({ name, value }); return { eq: async () => ({}) }; },
    }),
    storage: { from: () => ({ remove: async paths => { effects.push({ name: "remove", paths }); return {}; } }) },
  } };
}

test("delete-upload denies missing/foreign capabilities and lookup failure before deletion or reservation mutation", async () => {
  for (const [options, browser, status] of [[{}, undefined, 400], [{ allowed: false }, browserId, 403],
    [{ allowed: null }, browserId, 403], [{ ownershipError: { message: "offline" } }, browserId, 503]]) {
    const { client, effects } = deletionClient(options);
    const response = await handlerFor("form-admin", {}, client)(null, "POST", {
      action: "delete-upload", formId, path, browserId: browser, personalToken: browserId,
    });
    assert.equal(response.status, status);
    assert.ok(effects.every(effect => effect.name === "can_restore_survey_upload"));
  }
});

test("reserve-upload routes personal tokens to the atomic personal reservation RPC", async () => {
  for (const personalToken of [undefined, browserId, "invalid"]) {
    const calls = [];
    const client = { rpc: async (name, args) => { calls.push({ name, args }); return { data: path }; } };
    const response = await handlerFor("form-admin", {}, client)(null, "POST", {
      action: "reserve-upload", formId, browserId, size: 1, extension: ".txt", personalToken,
    }, { "x-survey-client-ip": "127.0.0.1" });
    assert.equal(response.status, personalToken === "invalid" ? 400 : 200);
    if (personalToken === "invalid") { assert.deepEqual(calls, []); continue; }
    assert.equal(calls[0].name, personalToken ? "reserve_personal_survey_upload" : "reserve_survey_upload");
    assert.equal(calls[0].args.p_browser_id, browserId);
    assert.equal(calls[0].args.p_token, personalToken);
    assert.match(calls[0].args.p_client_hash, /^[a-f0-9]{64}$/);
  }
});

test("restoring an existing personal draft binds both capabilities before signing", async () => {
  for (const bound of [true, false]) {
    const calls = [];
    const client = {
      rpc: async (name, args) => {
        calls.push({ name, args });
        return { data: name === "can_restore_survey_upload" ? true : bound };
      },
      storage: { from: () => ({ createSignedUrl: async () => {
        calls.push({ name: "sign" });
        return { data: { signedUrl: `https://api.test/storage/v1/object/sign/survey-files/${path}?token=test` } };
      } }) },
    };
    const response = await handlerFor("form-admin", {}, client)(null, "POST", {
      action: "restore-upload", formId, browserId, path, personalToken: browserId,
    });
    assert.equal(response.status, bound ? 200 : 410);
    assert.deepEqual(calls[1], { name: "bind_personal_survey_upload", args: {
      p_form_id: formId, p_token: browserId, p_browser_id: browserId, p_path: path,
    } });
    assert.equal(calls.some(c => c.name === "sign"), bound);
  }
});

test("delete-upload preserves reference/form guards and removes only the authorized browser's unattached file", async () => {
  for (const [options, status] of [[{ referenced: true }, 409], [{ active: false }, 403], [{}, 200]]) {
    const { client, effects } = deletionClient(options);
    const response = await handlerFor("form-admin", {}, client)(null, "POST", { action: "delete-upload", formId, path, browserId });
    assert.equal(response.status, status);
    assert.deepEqual(effects[0], { name: "can_restore_survey_upload", args: { p_path: path, p_browser_id: browserId } });
    assert.equal(effects.some(effect => effect.name === "remove"), status === 200);
    assert.equal(effects.some(effect => effect.name === "survey_upload_reservations"), status === 200);
  }
});

test("update-schema rejects a stale editor and stale confirmation without performing a write", async () => {
  // The handler's import is replaced with the real compatibility implementation.
  const { analyzeSchemaCompatibility } = await import("./form-admin/schemaCompatibility.mjs");
  globalThis.analyzeSchemaCompatibility = analyzeSchemaCompatibility;
  try {
    const owner = "a5000000-0000-4000-8000-000000000001";
    let revision = 4, writes = 0;
    const client = {
      auth: { getUser: async () => ({ data: { user: { id: owner } } }) },
      from: table => ({
        updating: false, predicates: {},
        select() { return this; }, eq(key, value) { this.predicates[key] = value; return this; },
        single: async () => ({ data: table === "profiles" ? { role: "user", is_disabled: false }
          : { id: formId, author_id: owner, revision, schema: { pages: [{ elements: [{ type: "text", name: "q" }] }] }, responses_count: 1, organization_types: ["school"] } }),
        update() { this.updating = true; return this; },
        async maybeSingle() {
          assert.equal(this.predicates.revision, revision);
          writes++; revision++; return { data: { id: formId } };
        },
      }),
    };
    const request = handlerFor("form-admin", {}, client);
    const payload = { action: "update-schema", formId, schema: { pages: [{ elements: [{ type: "text", name: "q" }, { type: "text", name: "new" }] }] },
      theme: {}, title: "Changed", allowResponseEditing: false, organizationTypes: ["school"], expectedRevision: 4 };
    const send = body => request(null, "POST", body, { Authorization: "Bearer test" });
    assert.equal((await (await send(payload)).json()).status, "confirmation_required");
    assert.equal(writes, 0);
    revision = 5; // Another editor saves before the warning is confirmed.
    assert.equal((await send({ ...payload, confirmWarnings: true })).status, 409);
    assert.equal(writes, 0);
    assert.equal((await send({ ...payload, expectedRevision: 5, confirmWarnings: true })).status, 200);
    assert.equal(writes, 1);
    assert.equal((await send({ ...payload, expectedRevision: 5, confirmWarnings: true })).status, 409);
    assert.equal(writes, 1);
  } finally { delete globalThis.analyzeSchemaCompatibility; }
});

test("delete-responses delegates actor authorization and the complete reference decision to SQL", async () => {
  const owner = "a5000000-0000-4000-8000-000000000001";
  for (const errorCode of [null, "42501", "P0002"]) {
    const calls = [], removed = [];
    const client = {
      auth: { getUser: async () => ({ data: { user: { id: owner } } }) },
      from: table => {
        assert.equal(table, "profiles");
        return { select() { return this; }, eq() { return this; }, single: async () => ({ data: { role: "user", is_disabled: false } }) };
      },
      rpc: async (name, args) => {
        calls.push({ name, args });
        return errorCode ? { error: { code: errorCode, message: "denied" } } : { data: { deletedResponses: 1, objectPaths: [path] } };
      },
      storage: { from: () => ({ remove: async paths => { removed.push(...paths); return {}; } }) },
    };
    const response = await handlerFor("form-admin", {}, client)(null, "POST", { action: "delete-responses", formId, responseIds: [browserId] }, { Authorization: "Bearer test" });
    assert.equal(response.status, errorCode === "42501" ? 403 : errorCode === "P0002" ? 404 : 200);
    assert.deepEqual(calls, [{ name: "delete_form_responses_with_files", args: { p_form_id: formId, p_response_ids: [browserId], p_actor_id: owner } }]);
    assert.deepEqual(removed, errorCode ? [] : [path]);
  }
});
