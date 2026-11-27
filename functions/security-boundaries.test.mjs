import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { webcrypto } from "node:crypto";
import test from "node:test";
import { authFailure, isUpstreamUnavailable } from "./_shared/auth-failure.mjs";
import ts from "../frontend/node_modules/typescript/lib/typescript.js";

function handlerFor(name, environment = {}, client = {}) {
  const source = readFileSync(new URL(`./${name}/index.ts`, import.meta.url), "utf8").replace(/^import .*;\n/gm, "");
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } });
  let handler;
  const env = { SUPABASE_URL: "https://api.test", SUPABASE_ANON_KEY: "anon", SUPABASE_SERVICE_ROLE_KEY: "service", ...environment };
  new Function("Deno", "createClient", "crypto", "console", "authFailure", "isUpstreamUnavailable", compiled.outputText)(
    { env: { get: key => env[key] }, serve: callback => { handler = callback; } },
    () => client, webcrypto, { info() {}, error() {} }, authFailure, isUpstreamUnavailable,
  );
  return (origin, method = "OPTIONS", payload = {}, headers = {}) => handler(new Request("https://api.test/functions", {
    method, headers: { ...(origin === null ? {} : { Origin: origin }), ...headers },
    ...(method === "POST" ? { body: JSON.stringify(payload) } : {}),
  }));
}

for (const [name, key] of [["form-admin", "FORM_ADMIN_ALLOWED_ORIGINS"], ["user-admin", "USER_ADMIN_ALLOWED_ORIGINS"],
  ["mail-admin", "MAIL_ADMIN_ALLOWED_ORIGINS"], ["app-settings", "MAIL_ADMIN_ALLOWED_ORIGINS"]]) {
  test(`${name}: refuses access on revocation and distinguishes an Auth outage`, async () => {
    for (const [authError, status, code] of [
      [{ name: "AuthSessionMissingError" }, 401, "session_not_found"],
      [{ code: "bad_jwt", status: 403, message: "invalid JWT: token is expired" }, 401, "token_expired"],
      [{ name: "AuthRetryableFetchError", status: 503 }, 503, "auth_unavailable"],
    ]) {
      const request = handlerFor(name, {}, { auth: { getUser: async () => ({ data: { user: null }, error: authError }) } });
      const response = await request(null, "POST", { action: name === "form-admin" ? "get-cleanup-status" : "list" }, { Authorization: "Bearer test" });
      assert.equal(response.status, status);
      assert.equal((await response.json()).code, code);
    }
  });

  test(`${name}: reports profile lookup outages separately from permission errors`, async () => {
    const query = { select: () => query, eq: () => query, single: async () => ({
      data: null, error: { message: "Unavailable" }, status: 503,
    }) };
    const request = handlerFor(name, {}, {
      auth: { getUser: async () => ({ data: { user: { id: "employee" } }, error: null }) },
      from: () => query,
    });
    const payload = { action: name === "form-admin" ? "get-cleanup-status" : "list" };
    const response = await request(null, "POST", payload, { Authorization: "Bearer test" });
    assert.equal(response.status, 503);
  });

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

  test(`${name}: preflight permits the frontend's actual correlation headers`, async () => {
    const requested = ["authorization", "x-client-info", "apikey", "content-type", "x-request-id", "x-trace-id", "traceparent", "x-client-release"];
    const response = await handlerFor(name, { [key]: "https://forms.test" })("https://forms.test", "OPTIONS", {}, {
      "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": requested.join(", "),
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Access-Control-Allow-Origin"), "https://forms.test");
    const allowed = response.headers.get("Access-Control-Allow-Headers").toLowerCase().split(/,\s*/);
    for (const header of requested) assert.ok(allowed.includes(header), header);
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
    assert.equal(calls[0].name, "assert_survey_upload_type");
    assert.equal(calls[1].name, personalToken ? "reserve_personal_survey_upload" : "reserve_survey_upload");
    assert.equal(calls[1].args.p_browser_id, browserId);
    assert.equal(calls[1].args.p_token, personalToken);
    assert.match(calls[1].args.p_client_hash, /^[a-f0-9]{64}$/);
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

test("update-schema rechecks the first response, blocks incompatible confirmed edits and rejects stale confirmations", async () => {
  // The handler's import is replaced with the real compatibility implementation.
  const { analyzeSchemaCompatibility } = await import("./form-admin/schemaCompatibility.mjs");
  globalThis.analyzeSchemaCompatibility = analyzeSchemaCompatibility;
  try {
    const owner = "a5000000-0000-4000-8000-000000000001";
    let revision = 4, writes = 0, responseCount = 0;
    const client = {
      auth: { getUser: async () => ({ data: { user: { id: owner } } }) },
      from: table => ({
        updating: false, predicates: {},
        select() { return this; }, eq(key, value) { this.predicates[key] = value; return this; },
        single: async () => ({ data: table === "profiles" ? { role: "user", is_disabled: false }
          : { id: formId, author_id: owner, revision, schema: { pages: [{ elements: [{ type: "text", name: "q" }] }] }, responses_count: responseCount, organization_types: ["school"] } }),
        update() { this.updating = true; return this; },
        async maybeSingle() {
          assert.equal(this.predicates.revision, revision);
          if (responseCount === 0) responseCount++; // First submission arrives after the handler read the form.
          if (this.predicates.responses_count !== responseCount) return { data: null };
          writes++; revision++; return { data: { id: formId } };
        },
      }),
    };
    const request = handlerFor("form-admin", {}, client);
    const payload = { action: "update-schema", formId,
      theme: {}, title: "Changed", allowResponseEditing: false, organizationTypes: ["school"], expectedRevision: 4 };
    const send = body => request(null, "POST", body, { Authorization: "Bearer test" });
    const changedStorage = { ...payload, confirmWarnings: true,
      schema: { pages: [{ elements: [{ type: "text", name: "q", maskType: "numeric" }] }] } };
    assert.equal((await (await send(changedStorage)).json()).status, "blocked");
    const risk = { ...payload, schema: { pages: [{ elements: [{ type: "text", name: "q", clearIfInvisible: "onHidden" }] }] } };
    assert.equal((await (await send(risk)).json()).status, "confirmation_required");
    assert.equal(writes, 0);
    revision = 5; // Another editor saves before the warning is confirmed.
    assert.equal((await send({ ...risk, confirmWarnings: true })).status, 409);
    assert.equal(writes, 0);
    assert.equal((await (await send({ ...risk, expectedRevision: 5, confirmWarnings: true })).json()).status, "updated");
    assert.equal(writes, 1);
    assert.equal((await send({ ...risk, expectedRevision: 5, confirmWarnings: true })).status, 409);
    assert.equal(writes, 1);
    const safe = { ...payload, expectedRevision: 6, schema: { pages: [{ elements: [{ type: "text", name: "q", title: "Новое название" }] }] } };
    assert.equal((await (await send(safe)).json()).status, "updated");
    assert.equal(writes, 2);
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

test("delete-form delegates all references to SQL and removes more than 1000 paths in batches", async () => {
  const owner = "a5000000-0000-4000-8000-000000000001";
  const paths = Array.from({ length: 1005 }, (_, index) => `public/${formId}/${index}.pdf`);
  for (const code of [null, "42501", "P0002", "offline"]) {
    const calls = [], batches = [];
    const client = {
      auth: { getUser: async () => ({ data: { user: { id: owner } } }) },
      from: table => {
        assert.equal(table, "profiles");
        return { select() { return this; }, eq() { return this; }, single: async () => ({ data: { role: "user", is_disabled: false } }) };
      },
      rpc: async (name, args) => {
        calls.push({ name, args });
        return code ? { error: { code, message: "denied" } } : { data: { objectPaths: paths } };
      },
      storage: { from: bucket => ({
        list: async () => ({ data: [] }),
        remove: async objects => { assert.equal(bucket, "survey-files"); batches.push(objects); return {}; },
      }) },
    };
    const response = await handlerFor("form-admin", {}, client)(null, "POST", { action: "delete", formId }, { Authorization: "Bearer test" });
    assert.equal(response.status, code === "42501" ? 403 : code === "P0002" ? 404 : code ? 400 : 200);
    assert.deepEqual(calls, [{ name: "delete_form_with_files", args: { p_form_id: formId, p_actor_id: owner } }]);
    assert.deepEqual(batches.flat(), code ? [] : paths);
    assert.ok(batches.every(batch => batch.length <= 100));
    if (!code) assert.equal((await response.json()).removedFiles, paths.length);
  }
});

const administratorId = "ad010000-0000-4000-8000-000000000001";
const employeeId = "ad010000-0000-4000-8000-000000000002";

test("setDisabled delegates the atomic Auth/profile transition to SQL and rejects invalid input", async () => {
  for (const code of [null, "42501", "P0002", "XX000"]) {
    const calls = [];
    const client = {
      auth: { getUser: async () => ({ data: { user: { id: administratorId } } }) },
      from: () => ({ select() { return this; }, eq() { return this; }, single: async () => ({ data: { role: "admin", is_disabled: false } }) }),
      rpc: async (name, args) => { calls.push({ name, args }); return code ? { error: { code, message: "rejected" } } : { data: true }; },
    };
    const send = disabled => handlerFor("user-admin", {}, client)(null, "POST", { action: "setDisabled", userId: employeeId, disabled }, { Authorization: "Bearer test" });
    assert.equal((await send(true)).status, code === "42501" ? 403 : code === "P0002" ? 404 : code ? 400 : 200);
    assert.deepEqual(calls, [{ name: "set_employee_disabled", args: { p_user_id: employeeId, p_disabled: true, p_actor_id: administratorId } }]);
    calls.length = 0;
    for (const disabled of ["false", null, undefined, 1]) assert.equal((await send(disabled)).status, 400);
    assert.deepEqual(calls, []);
  }
});

function userAdminFixture() {
  const calls = [];
  const client = {
    auth: {
      getUser: async () => ({ data: { user: { id: administratorId } } }),
      admin: {
        async createUser(attributes) {
          calls.push({ action: "create", attributes });
          return { data: { user: { id: "created-user" } } };
        },
        async updateUserById(userId, attributes) {
          calls.push({ action: "updatePassword", userId, attributes });
          return {};
        },
      },
    },
    from: () => ({
      select() { return this; },
      eq() { return this; },
      single: async () => ({ data: { role: "admin", is_disabled: false } }),
      upsert: async () => ({}),
    }),
  };
  const request = handlerFor("user-admin", {}, client);
  return { calls, send: payload => request(null, "POST", payload, { Authorization: "Bearer test" }) };
}

test("updatePassword handles self, another user and invalid reset requests", async () => {
  const { calls, send } = userAdminFixture();
  const password = "🔑".repeat(18);
  const reset = { action: "updatePassword", userId: employeeId, password };

  assert.equal((await send({ ...reset, userId: administratorId })).status, 403);
  assert.equal((await send({ ...reset, userId: administratorId.toUpperCase() })).status, 403);
  for (const invalid of [
    { userId: null }, { userId: [employeeId] }, { userId: "" }, { userId: "invalid-id" },
    { password: 1234 }, { password: "12345678901" },
    { password: "🔑".repeat(11) }, { password: "🔑".repeat(19) },
  ]) {
    assert.equal((await send({ ...reset, ...invalid })).status, 400, JSON.stringify(invalid));
  }
  assert.deepEqual(calls, []);

  const response = await send(reset);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { success: true });
  assert.deepEqual(calls, [{ action: "updatePassword", userId: employeeId, attributes: { password } }]);
});

test("create validates the JSON body and user fields before calling Auth", async () => {
  const { calls, send } = userAdminFixture();
  const create = { action: "create", name: " Имя ", email: " person@example.test ", password: "123456789012", role: "user" };
  for (const payload of [
    null, [], 1, "", { action: null },
    { ...create, name: true }, { ...create, email: {} }, { ...create, password: null },
    { ...create, password: "12345678901" }, { ...create, password: "я".repeat(37) },
  ]) {
    assert.equal((await send(payload)).status, 400, JSON.stringify(payload));
  }
  assert.deepEqual(calls, []);

  const response = await send(create);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { userId: "created-user" });
  assert.deepEqual(calls, [{
    action: "create",
    attributes: {
      email: "person@example.test",
      email_confirm: true,
      password: create.password,
      user_metadata: { name: "Имя" },
    },
  }]);
});

test("schema settings retain untouched deadlines and limits and reject malformed changes before writing", async () => {
  const owner = "a5000000-0000-4000-8000-000000000001";
  const writes = [];
  const client = {
    auth: { getUser: async () => ({ data: { user: { id: owner } } }) },
    from: table => ({
      select() { return this; }, eq() { return this; },
      single: async () => ({ data: table === "profiles" ? { role: "user", is_disabled: false }
        : { id: formId, author_id: owner, revision: 1, schema: { pages: [] }, responses_count: 0 } }),
      update(payload) { writes.push(payload); return this; },
      maybeSingle: async () => ({ data: { id: formId } }),
    }),
  };
  const request = handlerFor("form-admin", {}, client);
  const payload = { action: "update-schema", formId, schema: { pages: [] }, theme: {}, title: "Settings",
    expectedRevision: 1, allowResponseEditing: true, organizationTypes: ["school", "odo"] };
  const send = settings => request(null, "POST", { ...payload, settings }, { Authorization: "Bearer test" });
  assert.equal((await send({ formType: "monitoring", formReason: "order" })).status, 200);
  assert.equal(writes[0].form_type, "monitoring");
  assert.equal(writes[0].allow_response_editing, true);
  assert.deepEqual(writes[0].organization_types, ["school", "odo"]);
  assert.equal("deadline_at" in writes[0], false);
  assert.equal("max_responses" in writes[0], false);
  assert.equal("is_public" in writes[0], false);
  assert.equal((await send({ formType: "monitoring", formReason: "order", deadlineAt: "2020-01-01T00:00:00Z", maxResponses: 10 })).status, 200);
  assert.equal(writes[1].deadline_at, null);
  assert.equal(writes[1].is_public, false);
  assert.equal(writes[1].max_responses, 10);
  for (const invalid of [{ maxResponses: 0 }, { maxResponses: 1.5 }, { maxResponses: 100001 }, { deadlineAt: false }, { deadlineAt: "invalid" }, { formType: "" }]) {
    assert.equal((await send({ formType: "monitoring", formReason: "order", ...invalid })).status, 400);
  }
  assert.equal(writes.length, 2);
});

test("restore-upload returns 503 on database error during personal binding/check", async () => {
  for (const failingRpc of ["bind_personal_survey_upload", "can_restore_personal_upload"]) {
    const client = {
      rpc: async (name) => {
        if (name === "can_restore_survey_upload") return { data: failingRpc === "bind_personal_survey_upload" };
        if (name === failingRpc) return { data: null, error: { message: "db timeout" } };
        return { data: false };
      },
      storage: { from: () => ({ createSignedUrl: async () => ({ data: { signedUrl: "https://api.test/s" } }) }) },
    };
    const response = await handlerFor("form-admin", {}, client)(null, "POST", {
      action: "restore-upload", formId, browserId, path, personalToken: browserId,
    });
    assert.equal(response.status, 503, failingRpc);
  }
});

test("user-admin routes employee mutations through atomic RPCs and delegates password reset to GoTrue", async () => {
  const calls = [];
  const client = {
    auth: {
      getUser: async () => ({ data: { user: { id: administratorId } } }),
      admin: {
        async deleteUser(userId) { calls.push({ action: "deleteUser", userId }); return {}; },
        async updateUserById(userId, attributes) { calls.push({ action: "updateUserById", userId, attributes }); return {}; },
        async signOut(userId, scope) { calls.push({ action: "signOut", userId, scope }); return {}; },
      },
    },
    from: () => ({ select() { return this; }, eq() { return this; }, single: async () => ({ data: { role: "admin", is_disabled: false } }) }),
    rpc: async (name, args) => { calls.push({ action: "rpc", name, args }); return { data: true }; },
  };
  const send = payload => handlerFor("user-admin", {}, client)(null, "POST", payload, { Authorization: "Bearer test" });

  assert.equal((await send({ action: "updateRole", userId: employeeId, role: "admin" })).status, 200);
  assert.equal((await send({ action: "delete", userId: employeeId })).status, 200);
  assert.equal((await send({ action: "updatePassword", userId: employeeId, password: "123456789012" })).status, 200);
  assert.deepEqual(calls.map(c => c.action === "rpc" ? c.name : c.action), [
    "set_employee_role", "delete_employee", "updateUserById",
  ]);
});
