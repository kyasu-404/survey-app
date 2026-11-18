import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import { strFromU8, Unzip, unzipSync } from 'fflate';
import { attachment, createArchiveFixture, formId, organizationId, otherFormId, responseId } from './fixtures/response-archive.mjs';

const setup = (t, options) => createArchiveFixture(fn => t.after(fn), options);

async function downloadTicket(preparation) {
  assert.equal(preparation.status, 200);
  const { ticket } = await preparation.json();
  const cookieHeader = preparation.headers.get('set-cookie');
  assert.ok(ticket);
  assert.match(cookieHeader, /HttpOnly; SameSite=Strict/);
  assert.ok(cookieHeader.includes(`/api/office/response-archives/${ticket}`));
  return [ticket, cookieHeader.split(';')[0]];
}

test('ZIP access requires an active session and a matching single-use download cookie', async t => {
  const answers = [{ id: responseId(1), data: { files: [attachment('one.pdf')] } }];
  const running = await setup(t, { answers, storage: { 'one.pdf': 'file' } });
  const disabled = await setup(t, { disabled: true });
  assert.equal((await running.prepare({}, 'invalid')).status, 401);
  assert.equal((await disabled.prepare()).status, 403);
  assert.equal((await running.prepare({}, 'employee', otherFormId)).status, 404);
  assert.equal((await running.prepare({ selected: [{ id: responseId(2), number: 2 }] })).status, 409);
  const args = await downloadTicket(await running.prepare());
  assert.equal((await running.download(args[0])).status, 404);
  const archive = await running.download(...args);
  assert.equal(archive.status, 200);
  assert.equal(archive.headers.get('cache-control'), 'no-store');
  assert.equal(archive.headers.get('x-accel-buffering'), 'no');
  assert.ok(archive.headers.get('content-disposition').includes(encodeURIComponent('Файлы-Сбор документов.zip')));
  assert.equal(strFromU8(unzipSync(new Uint8Array(await archive.arrayBuffer()))['Ответ — 001/1_Документ.pdf']), 'file');
  assert.equal((await running.download(...args)).status, 404);
  assert.ok(running.requests.every(r => r.headers.authorization === 'Bearer employee' && r.headers.apikey === 'public-key'));
  assert.equal(disabled.requests.length, 0);
});

test('selected rows keep their numbers, legacy bytes, organization names and valid ZIPs after Storage fails', async t => {
  const answer = { id: responseId(101), data: { entries: [{ school: organizationId }], files: [
    attachment('valid.pdf'), attachment('truncated.pdf'), attachment('missing.pdf'),
    { name: 'Старый.pdf', content: 'data:application/pdf;base64,AAEC/w==' },
    { name: 'URL.pdf', content: `https://api.forms.test/storage/v1/object/sign/survey-files/public/${formId}/legacy%20name.pdf?token=expired` },
    { name: 'Чужой.pdf', content: `public/${otherFormId}/valid.pdf` },
    { name: 'Ссылка.pdf', content: `https://external.test/storage/v1/object/sign/survey-files/public/${formId}/valid.pdf` },
  ] } };
  const { prepare, download, requests } = await setup(t, {
    answers: [{ id: responseId(1), data: { files: [attachment('unselected.pdf')] } }, answer],
    storage: {
      'valid.pdf': 'original bytes',
      'legacy name.pdf': 'legacy object',
      'truncated.pdf': res => {
        res.writeHead(200, { 'Content-Length': 40 });
        res.write('incomplete');
        setTimeout(() => res.destroy(), 10);
      },
    },
  });
  const archive = await download(...await downloadTicket(await prepare({ selected: [{ id: answer.id, number: 101 }] })));
  const entries = unzipSync(new Uint8Array(await archive.arrayBuffer()));
  const folder = 'ГБОУ 373 — 101';
  assert.deepEqual(Object.keys(entries), [
    `${folder}/1_Документ.pdf`, `${folder}/4_Старый.pdf`, `${folder}/5_URL.pdf`, 'Не удалось скачать.txt',
  ]);
  assert.equal(strFromU8(entries[`${folder}/1_Документ.pdf`]), 'original bytes');
  assert.deepEqual([...entries[`${folder}/4_Старый.pdf`]], [0, 1, 2, 255]);
  assert.equal(strFromU8(entries[`${folder}/5_URL.pdf`]), 'legacy object');
  const report = strFromU8(entries['Не удалось скачать.txt']);
  assert.match(report, /4 из 7 файлов/);
  for (const name of ['2_Документ.pdf', '3_Документ.pdf', '6_Чужой.pdf', '7_Ссылка.pdf']) assert.ok(report.includes(`${folder}/${name}`));
  assert.ok(!requests.some(r => r.path.includes(otherFormId) || r.path.includes('unselected')));
});

test('an empty selection of attachments has no ticket', async t => {
  const { prepare } = await setup(t, { answers: [{ id: responseId(1), data: { text: attachment('ignored.pdf') } }] });
  const response = await prepare();
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ticket: null });
  assert.equal(response.headers.get('set-cookie'), null);
});

test('closing the download aborts the active Storage read', { timeout: 10_000 }, async t => {
  let startFile, closeFile;
  const started = new Promise(resolve => { startFile = resolve; });
  const closed = new Promise(resolve => { closeFile = resolve; });
  const { prepare, download } = await setup(t, {
    answers: [{ id: responseId(1), data: { files: [attachment('pending.pdf')] } }],
    storage: { 'pending.pdf': res => {
      res.once('close', closeFile);
      res.write('first bytes');
      startFile();
    } },
  });
  const controller = new AbortController();
  const archive = await download(...await downloadTicket(await prepare()), { signal: controller.signal });
  assert.equal(archive.status, 200);
  await started;
  controller.abort();
  await closed;
  assert.equal((await prepare()).status, 200);
});

test('finishes a valid partial ZIP after consecutive Storage stalls', { timeout: 10_000 }, async t => {
  const timeout = AbortSignal.timeout;
  t.mock.method(AbortSignal, 'timeout', ms => timeout(ms === 60_000 ? 200 : ms === 90_000 ? 350 : ms));
  const { prepare, download, requests } = await setup(t, {
    answers: [{ id: responseId(1), data: { files: ['ready.pdf', 'stall1.pdf', 'stall2.pdf', 'later.pdf']
      .map(name => attachment(name, name)) } }],
    storage: { 'ready.pdf': 'available', 'stall1.pdf': () => {}, 'stall2.pdf': () => {}, 'later.pdf': 'skipped' },
  });
  const archive = await download(...await downloadTicket(await prepare()));
  const entries = unzipSync(new Uint8Array(await archive.arrayBuffer()));
  assert.equal(strFromU8(entries['Ответ — 001/1_ready.pdf']), 'available');
  const report = strFromU8(entries['Не удалось скачать.txt']);
  assert.match(report, /3 из 4 файлов\. Хранилище долго не отвечало/);
  assert.ok(report.includes('Ответ — 001/4_later.pdf'));
  assert.ok(!requests.some(request => request.path.endsWith('/later.pdf')));
});

test('streams a 200 MiB ZIP before all Storage objects have been produced', { timeout: 45_000 }, async t => {
  const names = ['a.pdf', 'b.pdf', 'c.pdf', 'd.pdf'];
  const bytesPerFile = 50 * 1024 * 1024;
  const chunk = Buffer.alloc(256 * 1024, 0x5a);
  const filesStarted = [];
  const filesFinished = [];
  let continueLast;
  const lastGate = new Promise(resolve => { continueLast = resolve; });
  t.after(continueLast);
  const storage = Object.fromEntries(names.map(name => [name, async res => {
    filesStarted.push(name);
    if (name === 'd.pdf') await lastGate;
    res.writeHead(200, { 'Content-Length': bytesPerFile });
    for (let offset = 0; offset < bytesPerFile; offset += chunk.length) {
      if (!res.write(chunk)) await once(res, 'drain');
    }
    res.end();
    filesFinished.push(name);
  }]));
  const { prepare, download } = await setup(t, {
    answers: [{ id: responseId(1), data: { files: names.map(name => attachment(name, name)) } }], storage,
  });
  const archive = await download(...await downloadTicket(await prepare()), { signal: AbortSignal.timeout(35_000) });
  assert.equal(archive.headers.get('content-length'), null);
  const reader = archive.body.getReader();
  const first = await reader.read();
  assert.deepEqual([...first.value.subarray(0, 4)], [0x50, 0x4b, 0x03, 0x04]);
  assert.ok(filesStarted.length > 0 && !filesFinished.includes('d.pdf'));
  continueLast();
  const sizes = new Map();
  const unzip = new Unzip(file => {
    let size = 0;
    file.ondata = (error, bytes, final) => {
      assert.ifError(error);
      size += bytes.length;
      if (final) sizes.set(file.name, size);
    };
    file.start();
  });
  unzip.push(first.value);
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    unzip.push(value);
  }
  unzip.push(new Uint8Array(), true);
  assert.deepEqual([...sizes], names.map((name, index) => [`Ответ — 001/${index + 1}_${name}`, bytesPerFile]));
});
