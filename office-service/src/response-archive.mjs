import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { finished, pipeline } from 'node:stream/promises';
import { createClient } from '@supabase/supabase-js';
import yazl from 'yazl';
import { collectResponseAttachments, getArchiveQuestions, safeArchiveName } from './response-archive-entries.mjs';
import { HttpError, readLimited, requireValue, uuid } from './security.mjs';

const DOWNLOAD_PATH = '/api/office/response-archives/';
const COOKIE_NAME = 'survey_response_zip';
const TICKET_TTL_SECONDS = 30;
// Each export stages one file in /tmp. Keep room for the editor and document worker.
const MAX_CONCURRENT_EXPORTS = 2;
const STORAGE_READ_TIMEOUT_MS = 60_000;
// nginx allows 120 seconds between upstream reads. Close a valid partial ZIP
// if consecutive stalled objects prevent the next entry from being sent.
const STORAGE_SILENCE_TIMEOUT_MS = 90_000;

async function readSelection(req) {
  let body;
  const raw = await readLimited(req, 1024 * 1024);
  try { body = JSON.parse(raw); } catch { throw new HttpError(400, 'Некорректные параметры выгрузки'); }
  requireValue(body && typeof body === 'object' && !Array.isArray(body), 'Некорректные параметры выгрузки');
  if (body.selected === undefined) return null;
  const { selected } = body;
  requireValue(Array.isArray(selected) && selected.length > 0 && selected.length <= 10_000 && selected.every(row =>
    row && uuid(row.id) && Number.isSafeInteger(row.number) && row.number > 0), 'Некорректно выбраны ответы');
  const numbers = new Map(selected.map(row => [row.id.toLowerCase(), row.number]));
  requireValue(numbers.size === selected.length && new Set(numbers.values()).size === numbers.size, 'Номера выбранных ответов повторяются');
  return numbers;
}

async function organizationLabels(client, signal) {
  const labels = new Map();
  const pageSize = 1000;
  for (let offset = 0; ; offset += pageSize) {
    const result = await client.from('education_organizations').select('id,alias,number')
      .order('id').range(offset, offset + pageSize - 1).abortSignal(signal);
    requireValue(!result.error && result.data, 'Не удалось прочитать справочник организаций', 502);
    for (const { id, alias, number } of result.data) labels.set(id, [alias.trim(), number?.trim()].filter(Boolean).join(' '));
    if (result.data.length < pageSize) return labels;
  }
}

async function prepareArchive(client, formId, selected, signal) {
  const form = await client.from('forms').select('title,schema').eq('id', formId).abortSignal(signal).maybeSingle();
  requireValue(!form.error, 'Не удалось загрузить форму для выгрузки', 502);
  requireValue(form.data, 'Форма не найдена', 404);
  const questions = getArchiveQuestions(form.data.schema);
  if (!questions.fileQuestions.length) return null;
  const { data: responses, error } = await client.rpc('export_form_responses', {
    p_form_id: formId,
    p_response_ids: selected ? [...selected.keys()] : null,
  }).abortSignal(signal);
  if (error?.code === '42501') throw new HttpError(403, 'Требуется действующая учётная запись');
  if (error?.code === '54000') throw new HttpError(413, 'Слишком много данных ответов. Выберите часть ответов для выгрузки.');
  requireValue(!error && Array.isArray(responses), 'Не удалось загрузить ответы для выгрузки', 502);
  requireValue(!selected || responses.length > 0, 'Выбранные ответы недоступны. Обновите список и повторите выгрузку.', 409);
  const labels = questions.organizationPaths.length ? await organizationLabels(client, signal) : new Map();
  const entries = collectResponseAttachments(responses, questions, labels, selected);
  if (!entries.length) return null;
  return { entries, filename: `Файлы-${safeArchiveName(form.data.title, 'форма')}.zip` };
}

function objectPath(value, formId, origins) {
  const explicit = [value.storagePath, value.path].find(key => typeof key === 'string');
  let path = typeof value === 'string' ? value : explicit ?? value.content;
  if (typeof path !== 'string') return null;
  if (explicit === undefined && URL.canParse(path)) {
    const url = new URL(path);
    const match = url.pathname.match(/\/object\/(?:sign|public)\/survey-files\/(.+)$/);
    if (!match || !origins.has(url.origin) || url.username || url.password) return null;
    path = decodeURIComponent(match[1]);
  }
  const [owner, form, file, extra] = path.split('/');
  if ((owner !== 'public' && !uuid(owner)) || form !== formId || !file || extra !== undefined ||
      file.length > 512 || file === '.' || file === '..' || /[\\\x00-\x1f\x7f]/.test(file)) return null;
  // Only the decoded object key is used. Never fetch a URL saved in an answer.
  return `${owner}/${form}/${encodeURIComponent(file)}`;
}

function inlineFile(value) {
  const content = typeof value === 'string' ? value : value.content;
  const header = typeof content === 'string' && /^data:[^,]*;base64,/i.exec(content);
  if (!header) throw new Error('Не удалось определить содержимое файла');
  const base64 = content.slice(header[0].length).replace(/[ \t\n\r\f]/g, '');
  const chunkSize = 64 * 1024;
  return Readable.from((function* () {
    for (let offset = 0; offset < base64.length; offset += chunkSize) {
      const part = base64.slice(offset, offset + chunkSize);
      if (offset + chunkSize < base64.length && part.includes('=')) throw new Error('Некорректный Base64');
      yield Buffer.from(atob(part), 'latin1');
    }
  })());
}

async function stageAttachment(value, { formId, origins, client }, stagedPath, streamSignal) {
  const path = objectPath(value, formId, origins);
  if (!path) return pipeline(inlineFile(value), createWriteStream(stagedPath), { signal: streamSignal });

  const signal = AbortSignal.any([streamSignal, AbortSignal.timeout(STORAGE_READ_TIMEOUT_MS)]);
  const { data, error } = await client.storage.from('survey-files').download(path, {}, { signal, cache: 'no-store' }).asStream();
  if (error || !data) throw new Error('Файл недоступен в хранилище');
  await pipeline(Readable.fromWeb(data), createWriteStream(stagedPath), { signal });
}

async function streamArchive(res, job, clearedCookie) {
  const controller = new AbortController();
  const { signal } = controller;
  const disconnect = () => { if (!res.writableFinished) controller.abort(); };
  res.once('close', disconnect);
  if (res.destroyed) disconnect();
  let directory, delivery;
  try {
    signal.throwIfAborted();
    directory = await mkdtemp(join(tmpdir(), 'survey-response-zip-'));
    signal.throwIfAborted();
    const stagedPath = join(directory, 'file');
    const zip = new yazl.ZipFile();
    zip.on('error', error => controller.abort(error));
    const filename = encodeURIComponent(job.filename).replace(/[!'()*]/g, char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="files.zip"; filename*=UTF-8''${filename}`);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Accel-Buffering', 'no');
    res.setHeader('Set-Cookie', clearedCookie);
    delivery = pipeline(zip.outputStream, res, { signal }).catch(error => controller.abort(error));
    res.flushHeaders();

    const failed = [];
    let silence = AbortSignal.timeout(STORAGE_SILENCE_TIMEOUT_MS);
    let interrupted = false;
    for (const [index, entry] of job.entries.entries()) {
      signal.throwIfAborted();
      try {
        // Finish reading the object before writing its ZIP header so a truncated
        // Storage response can be reported without corrupting the whole archive.
        await stageAttachment(entry.value, job, stagedPath, AbortSignal.any([signal, silence]));
      } catch {
        signal.throwIfAborted();
        if (silence.aborted) {
          interrupted = true;
          for (const remaining of job.entries.slice(index)) failed.push(remaining.archivePath);
          break;
        }
        failed.push(entry.archivePath);
        continue;
      }
      const file = createReadStream(stagedPath, { signal });
      const consumed = finished(file, { cleanup: true });
      zip.addReadStream(file, entry.archivePath, { compress: false });
      await consumed;
      silence = AbortSignal.timeout(STORAGE_SILENCE_TIMEOUT_MS);
    }
    if (failed.length) {
      const reason = interrupted ? ' Хранилище долго не отвечало, поэтому часть файлов не была запрошена.' : '';
      const report = `Не удалось получить ${failed.length} из ${job.entries.length} файлов.${reason} Повторите выгрузку или проверьте доступ к вложениям.\r\n\r\n${failed.sort().join('\r\n')}`;
      zip.addBuffer(Buffer.from(report), 'Не удалось скачать.txt', { compress: false });
    }
    zip.end();
    await delivery;
    signal.throwIfAborted();
  } catch (error) {
    if (!res.destroyed || error.name !== 'AbortError') throw error;
  } finally {
    res.off('close', disconnect);
    controller.abort();
    await delivery;
    if (directory) await rm(directory, { recursive: true, force: true });
  }
}

export function createResponseArchiveRoutes({ env, authenticateEmployee, send, secureCookies }) {
  const pending = new Map();
  let inUse = 0;
  const cookie = (ticket, value, ttl) => `${COOKIE_NAME}=${value}; Path=${DOWNLOAD_PATH}${ticket}; Max-Age=${ttl}; HttpOnly; SameSite=Strict${secureCookies ? '; Secure' : ''}`;

  return {
    async prepare(req, res, formId, token) {
      requireValue(uuid(formId), 'Неверный ID формы');
      await authenticateEmployee(token);
      requireValue(env.SUPABASE_ANON_KEY, 'Сервис выгрузки ZIP не настроен', 503);
      const selected = await readSelection(req);
      if (res.destroyed) return;
      requireValue(inUse < MAX_CONCURRENT_EXPORTS, 'На сервере уже идут выгрузки ZIP. Повторите позже.', 429);
      inUse++;
      let ticket;
      const controller = new AbortController();
      const disconnect = () => controller.abort();
      res.once('close', disconnect);
      try {
        const client = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
          accessToken: async () => token,
          global: { fetch: (url, options) => fetch(url, { ...options, redirect: 'error' }) },
        });
        const archive = await prepareArchive(client, formId, selected, AbortSignal.any([controller.signal, AbortSignal.timeout(80_000)]));
        if (res.destroyed) return;
        if (!archive) return send(res, 200, { ticket: null });
        const origins = new Set([env.SUPABASE_URL, env.SUPABASE_PUBLIC_URL].filter(Boolean).map(url => new URL(url).origin));
        ticket = randomUUID();
        const secret = randomBytes(32).toString('base64url');
        const timer = setTimeout(() => { pending.delete(ticket); inUse--; }, TICKET_TTL_SECONDS * 1000).unref();
        pending.set(ticket, { ...archive, client, formId, origins, secret, token, timer });
        send(res, 200, { ticket }, { 'Set-Cookie': cookie(ticket, secret, TICKET_TTL_SECONDS) });
      } finally {
        res.off('close', disconnect);
        if (!ticket) inUse--;
      }
    },

    async download(req, res, ticket) {
      const job = pending.get(ticket);
      const value = req.headers.cookie?.split(';').map(part => part.trim()).find(part => part.startsWith(`${COOKIE_NAME}=`))?.slice(COOKIE_NAME.length + 1);
      requireValue(job && /^[A-Za-z0-9_-]{43}$/.test(value ?? '') && timingSafeEqual(Buffer.from(value), Buffer.from(job.secret)), 'Ссылка на ZIP истекла. Запустите выгрузку снова.', 404);
      pending.delete(ticket);
      clearTimeout(job.timer);
      try {
        await authenticateEmployee(job.token);
        await streamArchive(res, job, cookie(ticket, '', 0));
      } finally {
        inUse--;
      }
    },
  };
}
