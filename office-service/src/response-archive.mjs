import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { finished, pipeline } from 'node:stream/promises';
import yazl from 'yazl';
import { collectResponseAttachments, getArchiveQuestions, safeArchiveName } from './response-archive-entries.mjs';
import { HttpError, readLimited, requireValue, uuid } from './security.mjs';

const DOWNLOAD_PATH = '/api/office/response-archives/';
const COOKIE_NAME = 'survey_response_zip';
const TICKET_TTL_SECONDS = 30;
// Each export stages one file in /tmp. Keep room for the editor and document worker.
const MAX_CONCURRENT_EXPORTS = 2;
const MAX_EXPORTS_PER_USER = 1;
const MAX_STAGED_ATTACHMENT_BYTES = 55 * 1024 * 1024;
const STORAGE_READ_TIMEOUT_MS = 60_000;
// nginx allows 120 seconds between upstream reads. Close a valid partial ZIP
// if consecutive stalled objects prevent the next entry from being sent.
const STORAGE_SILENCE_TIMEOUT_MS = 90_000;

function createSupabaseRestClient(supabaseUrl, anonKey, token) {
  const baseUrl = String(supabaseUrl || '').replace(/\/+$/, '');
  const baseHeaders = {
    apikey: anonKey,
    Authorization: `Bearer ${token}`,
  };
  async function requestJson(path, { method = 'GET', body, headers = {}, signal } = {}) {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        ...baseHeaders,
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...headers,
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      redirect: 'error',
      signal,
    });
    const text = await response.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { /* non-JSON error body */ }
    if (!response.ok) {
      return { data: null, error: data && typeof data === 'object' ? data : { status: response.status, message: 'Request failed' } };
    }
    return { data, error: null };
  }
  return {
    async getForm(formId, signal) {
      const result = await requestJson(`/rest/v1/forms?select=title,schema&id=eq.${encodeURIComponent(formId)}`, { signal });
      if (result.error) return result;
      return { data: Array.isArray(result.data) ? result.data[0] ?? null : result.data, error: null };
    },
    async exportResponses(formId, responseIds, signal) {
      return requestJson('/rest/v1/rpc/export_form_responses', {
        method: 'POST',
        body: { p_form_id: formId, p_response_ids: responseIds },
        signal,
      });
    },
    async listOrganizations(offset, pageSize, signal) {
      return requestJson('/rest/v1/education_organizations?select=id,alias,number&order=id.asc', {
        headers: { Range: `${offset}-${offset + pageSize - 1}`, 'Range-Unit': 'items' },
        signal,
      });
    },
    async downloadStorageObject(path, signal) {
      const response = await fetch(`${baseUrl}/storage/v1/object/authenticated/survey-files/${path}`, {
        method: 'GET',
        headers: baseHeaders,
        cache: 'no-store',
        redirect: 'error',
        signal,
      });
      if (!response.ok || !response.body) {
        await response.body?.cancel?.().catch(() => {});
        return { data: null, error: new Error(`Storage ${response.status}`) };
      }
      const contentLength = Number(response.headers.get('content-length') || 0);
      if (contentLength > MAX_STAGED_ATTACHMENT_BYTES) {
        await response.body.cancel().catch(() => {});
        return { data: null, error: new Error('Превышен допустимый размер вложения') };
      }
      return { data: response.body, error: null };
    },
  };
}

function createSizeLimitStream(limitBytes) {
  let seen = 0;
  return new Transform({
    transform(chunk, _encoding, callback) {
      seen += chunk.length;
      if (seen > limitBytes) callback(new Error('Превышен допустимый размер вложения'));
      else callback(null, chunk);
    },
  });
}

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
    const result = await client.listOrganizations(offset, pageSize, signal);
    requireValue(!result.error && Array.isArray(result.data), 'Не удалось прочитать справочник организаций', 502);
    for (const { id, alias, number } of result.data) labels.set(id, [alias.trim(), number?.trim()].filter(Boolean).join(' '));
    if (result.data.length < pageSize) return labels;
  }
}

async function prepareArchive(client, formId, selected, signal) {
  const form = await client.getForm(formId, signal);
  requireValue(!form.error, 'Не удалось загрузить форму для выгрузки', 502);
  requireValue(form.data, 'Форма не найдена', 404);
  const questions = getArchiveQuestions(form.data.schema);
  if (!questions.fileQuestions.length) return null;
  const { data: responses, error } = await client.exportResponses(
    formId,
    selected ? [...selected.keys()] : null,
    signal,
  );
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
  if (!path) {
    return pipeline(inlineFile(value), createSizeLimitStream(MAX_STAGED_ATTACHMENT_BYTES), createWriteStream(stagedPath), { signal: streamSignal });
  }

  const signal = AbortSignal.any([streamSignal, AbortSignal.timeout(STORAGE_READ_TIMEOUT_MS)]);
  const { data, error } = await client.downloadStorageObject(path, signal);
  if (error || !data) throw new Error('Файл недоступен в хранилище');
  await pipeline(Readable.fromWeb(data), createSizeLimitStream(MAX_STAGED_ATTACHMENT_BYTES), createWriteStream(stagedPath), { signal });
}

async function streamArchive(res, job, clearedCookie, onDisconnect) {
  const controller = new AbortController();
  const { signal } = controller;
  const disconnect = () => {
    if (!res.writableFinished) {
      onDisconnect?.();
      controller.abort();
    }
  };
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
  const inUseByUser = new Map();
  let inUse = 0;
  const acquireSlot = userId => {
    const userCount = inUseByUser.get(userId) ?? 0;
    requireValue(userCount < MAX_EXPORTS_PER_USER, 'У вас уже выполняется выгрузка ZIP. Дождитесь её завершения.', 429);
    requireValue(inUse < MAX_CONCURRENT_EXPORTS, 'На сервере уже идут выгрузки ZIP. Повторите позже.', 429);
    inUse++;
    inUseByUser.set(userId, userCount + 1);
  };
  const releaseUserSlot = userId => {
    const next = (inUseByUser.get(userId) ?? 1) - 1;
    if (next <= 0) inUseByUser.delete(userId);
    else inUseByUser.set(userId, next);
  };
  const releaseSlot = userId => {
    inUse = Math.max(0, inUse - 1);
    releaseUserSlot(userId);
  };
  const cookie = (ticket, value, ttl) => `${COOKIE_NAME}=${value}; Path=${DOWNLOAD_PATH}${ticket}; Max-Age=${ttl}; HttpOnly; SameSite=Strict${secureCookies ? '; Secure' : ''}`;

  return {
    async prepare(req, res, formId, token) {
      requireValue(uuid(formId), 'Неверный ID формы');
      const profile = await authenticateEmployee(token);
      const userId = profile?.id ?? 'employee';
      requireValue(env.SUPABASE_ANON_KEY, 'Сервис выгрузки ZIP не настроен', 503);
      const selected = await readSelection(req);
      if (res.destroyed) return;
      acquireSlot(userId);
      let ticket;
      const controller = new AbortController();
      const disconnect = () => controller.abort();
      res.once('close', disconnect);
      try {
        const client = createSupabaseRestClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, token);
        const archive = await prepareArchive(client, formId, selected, AbortSignal.any([controller.signal, AbortSignal.timeout(80_000)]));
        if (res.destroyed) return;
        if (!archive) return send(res, 200, { ticket: null });
        const origins = new Set([env.SUPABASE_URL, env.SUPABASE_PUBLIC_URL].filter(Boolean).map(url => new URL(url).origin));
        ticket = randomUUID();
        const secret = randomBytes(32).toString('base64url');
        const timer = setTimeout(() => { pending.delete(ticket); releaseSlot(userId); }, TICKET_TTL_SECONDS * 1000).unref();
        pending.set(ticket, { ...archive, client, formId, origins, secret, token, userId, timer });
        send(res, 200, { ticket }, { 'Set-Cookie': cookie(ticket, secret, TICKET_TTL_SECONDS) });
      } finally {
        res.off('close', disconnect);
        if (!ticket) releaseSlot(userId);
      }
    },

    async download(req, res, ticket) {
      const job = pending.get(ticket);
      const value = req.headers.cookie?.split(';').map(part => part.trim()).find(part => part.startsWith(`${COOKIE_NAME}=`))?.slice(COOKIE_NAME.length + 1);
      requireValue(job && /^[A-Za-z0-9_-]{43}$/.test(value ?? '') && timingSafeEqual(Buffer.from(value), Buffer.from(job.secret)), 'Ссылка на ZIP истекла. Запустите выгрузку снова.', 404);
      pending.delete(ticket);
      clearTimeout(job.timer);
      let userSlotReleased = false;
      const releaseUserOnce = () => {
        if (userSlotReleased) return;
        userSlotReleased = true;
        releaseUserSlot(job.userId);
      };
      try {
        await authenticateEmployee(job.token);
        await streamArchive(res, job, cookie(ticket, '', 0), releaseUserOnce);
      } finally {
        inUse = Math.max(0, inUse - 1);
        releaseUserOnce();
      }
    },
  };
}
