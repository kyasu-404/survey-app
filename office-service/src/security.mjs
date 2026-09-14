import { createHmac, timingSafeEqual, randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
export const requireValue = (value, message, status = 400) => { if (!value) throw new HttpError(status, message); };
export const uuid = (value) => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
export function sign(payload, secret) {
  const head = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const data = `${head}.${Buffer.from(JSON.stringify(payload)).toString('base64url')}`;
  return `${data}.${createHmac('sha256', secret).update(data).digest('base64url')}`;
}
export function verify(token, secret, now = Math.floor(Date.now() / 1000)) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3 || token.length > 100000) throw new Error();
    const header = JSON.parse(Buffer.from(parts[0], 'base64url'));
    if (header.alg !== 'HS256') throw new Error();
    const expected = createHmac('sha256', secret).update(`${parts[0]}.${parts[1]}`).digest();
    const actual = Buffer.from(parts[2], 'base64url');
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) throw new Error();
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url'));
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)
      || (payload.exp !== undefined && (!Number.isFinite(payload.exp) || payload.exp <= now))
      || (payload.nbf !== undefined && (!Number.isFinite(payload.nbf) || payload.nbf > now))) throw new Error();
    return payload;
  } catch { throw new HttpError(401, 'Недействительная или истёкшая подпись'); }
}
export function encryptionKey(base64) {
  const key = Buffer.from(base64 || '', 'base64');
  requireValue(key.length === 32, 'Не задан ONLYOFFICE_SETTINGS_ENCRYPTION_KEY', 503);
  return key;
}
export function encrypt(value, key) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), ciphertext].map(b => b.toString('base64')).join('.');
}
export function decrypt(value, key) {
  const [iv, tag, data] = value.split('.').map(v => Buffer.from(v, 'base64'));
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}
export function baseUrl(value, optional = false) {
  if (!value && optional) return '';
  let url;
  try { url = new URL(value); } catch { throw new HttpError(400, 'Некорректный адрес сервера'); }
  requireValue(['https:', 'http:'].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash,
    'Адрес должен быть HTTP(S), без пароля, параметров и фрагмента');
  return url.href.replace(/\/+$/, '');
}
// Only the configured Document Server may supply a save result. No redirects,
// arbitrary hosts, credentials or caller-selected protocols are followed.
export function saveUrl(value, settings) {
  let url;
  try { url = new URL(value); } catch { throw new HttpError(400, 'Некорректный адрес сохранения'); }
  const publicBase = new URL(settings.public_url + '/');
  const internalBase = new URL((settings.internal_url || settings.public_url) + '/');
  requireValue(!url.username && !url.password && !url.hash && [publicBase.origin, internalBase.origin].includes(url.origin),
    'Адрес сохранения не принадлежит ONLYOFFICE');
  const sourceBase = url.origin === publicBase.origin ? publicBase : internalBase;
  requireValue(url.pathname.startsWith(sourceBase.pathname + 'cache/files/'), 'Недопустимый путь файла ONLYOFFICE');
  // Keep the signed query verbatim when mapping the public address to the internal address.
  return internalBase.href.replace(/\/$/, '') + '/' + url.pathname.slice(sourceBase.pathname.length) + url.search;
}
export async function readLimited(stream, limit) {
  const chunks = []; let size = 0;
  for await (const chunk of stream) {
    size += chunk.length;
    requireValue(size <= limit, 'Превышен допустимый размер файла', 413);
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}
export async function fetchLimited(url, options = {}, limit = 1024 * 1024) {
  const response = await fetch(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(60000) });
  requireValue(response.ok, 'Удалённый сервер вернул ошибку', 502);
  requireValue(Number(response.headers.get('content-length') || 0) <= limit, 'Превышен размер ответа', 413);
  return readLimited(response.body, limit);
}
export function documentName(value, format = 'docx') {
  let name = String(value || '').trim().replace(/[\\/\x00-\x1f\x7f]/g, '');
  requireValue(['docx','xlsx'].includes(format), 'Поддерживаются DOCX и XLSX');
  name = name.replace(/\.(docx|xlsx)$/i, '') + '.' + format;
  requireValue(name.length >= 6 && name.length <= 200, 'Название должно содержать от 1 до 195 символов');
  return name;
}
export const documentKey = (doc) => `survey_${doc.id.replaceAll('-', '')}_v${doc.version}`;
