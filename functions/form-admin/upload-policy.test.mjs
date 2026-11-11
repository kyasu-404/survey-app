import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { webcrypto } from "node:crypto";
import test from "node:test";
import ts from "../../frontend/node_modules/typescript/lib/typescript.js";

function handlerFor(client) {
  const source = readFileSync(new URL("./index.ts", import.meta.url), "utf8").replace(/^import .*;\n/gm, "");
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } });
  let handler;
  const env = { SUPABASE_URL: "https://api.test", SUPABASE_ANON_KEY: "anon", SUPABASE_SERVICE_ROLE_KEY: "service" };
  new Function("Deno", "createClient", "crypto", "console", compiled.outputText)(
    { env: { get: key => env[key] }, serve: callback => { handler = callback; } },
    () => client, webcrypto, { info() {}, error() {} },
  );
  return payload => handler(new Request("https://api.test/functions", {
    method: "POST", headers: { "x-survey-client-ip": "127.0.0.1" }, body: JSON.stringify(payload),
  }));
}

const payload = { action: "reserve-upload", formId: "b5100000-0000-4000-8000-000000000001",
  browserId: "d5100000-0000-4000-8000-000000000001", size: 1, extension: ".exe", questionName: "documents", mimeType: "application/pdf" };

test("reserve-upload rejects the stored question's type mismatch before minting a reservation", async () => {
  const calls = [];
  const request = handlerFor({ rpc: async (name, args) => {
    calls.push({ name, args });
    return name === "assert_survey_upload_type" ? { error: { code: "22023", message: "Тип файла не разрешён автором вопроса" } }
      : { data: `public/${payload.formId}/file.exe` };
  } });
  const response = await request(payload);
  assert.equal(response.status, 400);
  assert.deepEqual(calls, [{ name: "assert_survey_upload_type", args: {
    p_form_id: payload.formId, p_question_name: "documents", p_file_name: ".exe", p_mime_type: "application/pdf",
  } }]);
});

test("reserve-upload checks persisted rules and preserves the personal reservation path", async () => {
  const calls = [];
  const request = handlerFor({ rpc: async (name, args) => {
    calls.push({ name, args }); return { data: name === "assert_survey_upload_type" ? true : `public/${payload.formId}/file.pdf` };
  } });
  const response = await request({ ...payload, extension: ".pdf", personalToken: payload.browserId });
  assert.equal(response.status, 200);
  assert.deepEqual(calls.map(call => call.name), ["assert_survey_upload_type", "reserve_personal_survey_upload"]);
  assert.equal(calls[1].args.p_token, payload.browserId);
});

test("reserve-upload accepts the PNG payload emitted by a remotely stored signature question", async () => {
  const calls = [];
  const path = `public/${payload.formId}/signature.png`;
  const request = handlerFor({ rpc: async (name, args) => {
    calls.push({ name, args }); return { data: name === "assert_survey_upload_type" ? true : path };
  } });
  const response = await request({ ...payload, extension: ".png", questionName: "signature", fileName: "signature.png", mimeType: "image/png" });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { path });
  assert.deepEqual(calls[0], { name: "assert_survey_upload_type", args: {
    p_form_id: payload.formId, p_question_name: "signature", p_file_name: "signature.png", p_mime_type: "image/png",
  } });
});

for (const [fileName, extension] of [["config.json.bak~", ".bak"], ["report.данные", ""], ["name.1234567890123", ""]]) {
  test(`reserve-upload preserves the client's storage suffix for unrestricted filename ${fileName}`, async () => {
    const calls = [];
    const path = `public/${payload.formId}/file${extension}`;
    const response = await handlerFor({ rpc: async (name, args) => {
      calls.push({ name, args }); return { data: name === "assert_survey_upload_type" ? true : path };
    } })({ ...payload, questionName: "anything", fileName, extension, mimeType: "application/octet-stream" });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { path });
    assert.equal(calls[0].args.p_file_name, fileName, "Author rules must use the original filename");
    assert.equal(calls[1].args.p_extension, extension);
  });
}

test("reserve-upload rejects a genuine filename and object-suffix mismatch before any RPC", async () => {
  const calls = [];
  const response = await handlerFor({ rpc: async name => { calls.push(name); return { data: true }; } })(
    { ...payload, questionName: "anything", fileName: "report.pdf", extension: ".exe" },
  );
  assert.equal(response.status, 400);
  assert.deepEqual(calls, []);
});

test("reserve-upload fails closed when the persisted type check is unavailable", async () => {
  const calls = [];
  const response = await handlerFor({ rpc: async name => {
    calls.push(name); return name === "assert_survey_upload_type" ? { error: { code: "08006", message: "offline" } } : { data: "path" };
  } })({ ...payload, extension: ".pdf" });
  assert.equal(response.status, 503);
  assert.deepEqual(calls, ["assert_survey_upload_type"]);
});
