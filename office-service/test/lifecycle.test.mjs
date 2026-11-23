import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import test from 'node:test';
import { shutdownOffice, startStorageCleanup } from '../src/lifecycle.mjs';

test('shutdown drains an active HTTP response and storage cleanup before ending PostgreSQL', async t => {
  const responseStarted = Promise.withResolvers();
  const pauseResponse = Promise.withResolvers();
  const server = createServer(async (_request, response) => {
    response.writeHead(200);
    response.write('start');
    responseStarted.resolve();
    await pauseResponse.promise;
    response.end(' finish');
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => { pauseResponse.resolve(); server.closeAllConnections(); server.close(); });
  const response = fetch(`http://127.0.0.1:${server.address().port}`);
  await responseStarted.promise;

  const cleanupStarted = Promise.withResolvers();
  const pauseCleanup = Promise.withResolvers();
  const events = [];
  const pool = {
    async query(sql) {
      if (sql.startsWith('select')) return { rows: [{ storage_path: 'old-template.docx' }] };
      if (sql.startsWith('delete from public.office_storage_cleanup')) events.push('cleanup record removed');
      return { rows: [] };
    },
    async end() { events.push('pool ended'); },
  };
  const store = { async remove() { cleanupStarted.resolve(); await pauseCleanup.promise; return {}; } };
  const stopStorageCleanup = startStorageCleanup({ pool, store, intervalMs: 1 });
  t.after(() => { pauseCleanup.resolve(); return stopStorageCleanup(); });
  await cleanupStarted.promise;
  const shutdown = shutdownOffice({
    server, pool, stopStorageCleanup,
    stopGenerationWorker: async () => { events.push('worker stopped'); },
  });
  pauseResponse.resolve();
  assert.equal(await (await response).text(), 'start finish');
  assert.deepEqual(events, ['worker stopped']);
  pauseCleanup.resolve();
  await shutdown;
  assert.deepEqual(events, ['worker stopped', 'cleanup record removed', 'pool ended']);
});
