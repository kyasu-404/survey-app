import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomBytes, randomUUID } from 'node:crypto';
import { createApp } from '../src/app.mjs';
import { blankDocx } from '../src/docx.mjs';
import { documentKey, encrypt, sign } from '../src/security.mjs';

async function setup(t, { onUpload = () => {}, failUpdate = false, loseCommit = false } = {}) {
  const key = randomBytes(32), secret = 'callback-test';
  const doc = { id: randomUUID(), form_id: randomUUID(), version: 1, storage_path: 'original.docx', file_type: 'docx', last_force_save_at: 0 };
  const settings = { public_url: 'https://docs.test', internal_url: 'http://onlyoffice', jwt_secret_encrypted: encrypt(secret, key), jwt_header: 'AuthorizationJwt', jwt_prefix: 'Bearer ', max_file_mb: 25 };
  const state = { doc, checkedOut: 0, uploads: [], removed: [], updates: 0, downloads: 0 };
  const query = async (sql, args = []) => {
    if (sql.includes('onlyoffice_settings')) return { rows: [settings] };
    if (sql.startsWith('select') && sql.includes('office_documents')) return { rows: state.doc ? [{ ...state.doc }] : [] };
    if (sql.includes('set storage_path=$2')) {
      if (failUpdate) throw new Error('simulated update failure');
      state.updates++;
      Object.assign(state.doc, { storage_path: args[1], version: state.doc.version + args[3], last_force_save_at: args[4] });
    }
    if (sql === 'commit' && loseCommit) throw new Error('simulated lost commit acknowledgement');
    return { rows: [] };
  };
  const pool = { query, connect: async () => {
    state.checkedOut++;
    return { query, release: () => { state.checkedOut--; } };
  } };
  const store = {
    upload: async path => {
      assert.equal(state.checkedOut, 0, 'Storage must run outside the transaction');
      state.uploads.push(path);
      await onUpload(state);
      return {};
    },
    remove: async paths => {
      assert.equal(state.checkedOut, 0, 'Cleanup must run after releasing the DB connection');
      state.removed.push(...paths);
      return {};
    },
  };
  const originalFetch = globalThis.fetch;
  t.mock.method(globalThis, 'fetch', (url, options) => {
    if (String(url).startsWith('http://onlyoffice/')) {
      assert.equal(state.checkedOut, 0, 'Document download must run outside the transaction');
      state.downloads++;
      return Promise.resolve(new Response(blankDocx()));
    }
    return originalFetch(url, options);
  });
  const app = createApp({ pool, supabase: { storage: { from: () => store } }, env: { PUBLIC_APP_URL: 'https://forms.test', ONLYOFFICE_SETTINGS_ENCRYPTION_KEY: key.toString('base64') } });
  const server = createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const callback = (payload = {}) => fetch(`http://127.0.0.1:${server.address().port}/api/office/callback/${doc.id}`, {
    method: 'POST', headers: { AuthorizationJwt: 'Bearer ' + sign({ payload: { key: documentKey(doc), status: 2, url: 'https://docs.test/cache/files/test.docx', ...payload } }, secret) }, body: '{}',
  });
  return { state, callback };
}

test('save callback downloads, inspects and uploads before checking out a DB connection', async t => {
  const { state, callback } = await setup(t);
  const response = await callback();
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { error: 0 });
  assert.equal(state.updates, 1);
  assert.equal(state.doc.version, 2);
  assert.equal(state.doc.storage_path, state.uploads[0]);
  assert.deepEqual(state.removed, []);
});

test('a completed session that wins during upload fences a slower final callback', async t => {
  const { state, callback } = await setup(t, { onUpload: state => { state.doc.version++; state.doc.storage_path = 'newer.docx'; } });
  assert.equal((await callback()).status, 200);
  assert.equal(state.updates, 0);
  assert.equal(state.doc.storage_path, 'newer.docx');
  assert.deepEqual(state.removed, state.uploads);
});

test('a newer force save wins over a slower force save within the same version', async t => {
  const { state, callback } = await setup(t, { onUpload: state => { state.doc.last_force_save_at = 300; state.doc.storage_path = 'newer.docx'; } });
  assert.equal((await callback({ status: 6, lastsave: 200 })).status, 200);
  assert.equal(state.updates, 0);
  assert.equal(state.doc.storage_path, 'newer.docx');
  assert.deepEqual(state.removed, state.uploads);
  assert.equal((await callback({ status: 6, lastsave: 300 })).status, 200);
  assert.equal(state.downloads, 1);
});

test('unordered force saves request a retry instead of replacing a changed file', async t => {
  const { state, callback } = await setup(t, { onUpload: state => { state.doc.storage_path = 'newer.docx'; } });
  assert.equal((await callback({ status: 6 })).status, 409);
  assert.equal(state.updates, 0);
  assert.deepEqual(state.removed, state.uploads);
});

test('deletion during upload removes the abandoned attempt', async t => {
  const { state, callback } = await setup(t, { onUpload: state => { state.doc = null; } });
  assert.equal((await callback()).status, 404);
  assert.deepEqual(state.removed, state.uploads);
});

test('failed UPDATE removes the abandoned attempt outside the transaction', async t => {
  const { state, callback } = await setup(t, { failUpdate: true });
  assert.equal((await callback()).status, 500);
  assert.deepEqual(state.removed, state.uploads);
});

test('lost COMMIT acknowledgement never deletes a potentially committed file', async t => {
  const { state, callback } = await setup(t, { loseCommit: true });
  assert.equal((await callback()).status, 500);
  assert.equal(state.doc.storage_path, state.uploads[0]);
  assert.deepEqual(state.removed, []);
});
