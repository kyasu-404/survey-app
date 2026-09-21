import { parentPort, workerData } from 'node:worker_threads';
import { unzipSync } from 'fflate';
import { readTemplate, checkTemplate, generateArchive } from './templates.mjs';
try {
  const { task, bytes, format, maxBytes, form, filename } = workerData;
  let result;
  if (task === 'inspect') {
    const template = readTemplate(Buffer.from(bytes), format, maxBytes);
    result = { fieldCount: template.bindings.length, fields: form ? checkTemplate(template, form) : undefined };
  } else if (task === 'extract') {
    const files = unzipSync(bytes, { filter: entry => entry.name === filename });
    if (!files[filename]) throw new Error('Файл не найден');
    result = { bytes: files[filename] };
  } else if (task === 'generate') {
    result = generateArchive({ ...workerData, bytes: Buffer.from(bytes), includeManifest: true });
  } else throw new Error('Неизвестная операция');
  parentPort.postMessage({ result });
} catch (error) {
  parentPort.postMessage({ error: error?.message || 'Не удалось обработать документ' });
}
