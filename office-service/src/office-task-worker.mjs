import { parentPort, workerData } from 'node:worker_threads';
import { unzipSync } from 'fflate';
import { readTemplate, checkTemplate, generateArchive } from './templates.mjs';
import { HttpError } from './security.mjs';
const asBuffer = bytes => (bytes instanceof Uint8Array ? Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength) : Buffer.from(bytes));
try {
  const { task, bytes, format, maxBytes, form, filename } = workerData;
  let result;
  if (task === 'inspect') {
    const template = readTemplate(asBuffer(bytes), format, maxBytes);
    result = { fieldCount: template.bindings.length, fields: form ? checkTemplate(template, form) : undefined };
  } else if (task === 'extract') {
    const files = unzipSync(bytes, { filter: entry => entry.name === filename });
    if (!files[filename]) throw new HttpError(404, 'Файл не найден');
    result = { bytes: files[filename] };
  } else if (task === 'generate') {
    result = generateArchive({ ...workerData, bytes: asBuffer(bytes), includeManifest: true });
  } else throw new HttpError(400, 'Неизвестная операция');
  const transferList = result?.bytes instanceof Uint8Array
    && result.bytes.byteOffset === 0
    && result.bytes.byteLength === result.bytes.buffer.byteLength
    ? [result.bytes.buffer]
    : [];
  parentPort.postMessage({ result }, transferList);
} catch (error) {
  const isExpected = error instanceof HttpError;
  parentPort.postMessage({
    error: isExpected ? error.message : 'Не удалось обработать документ',
    status: isExpected ? error.status : 422,
  });
}
