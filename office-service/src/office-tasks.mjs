import { Worker } from 'node:worker_threads';
import { HttpError } from './security.mjs';
// Generated results allow up to 90 MiB of file data plus ZIP metadata.
export const MAX_RESULT_ZIP_BYTES = 92 * 1024 * 1024;

// Limit both active workers and buffered uploads. Queued tasks have a deadline too.
export function createOfficeTaskRunner({ concurrency = 2, maxQueued = 4, timeoutMs = 75000 } = {}) {
  let active = 0;
  const pending = [];
  function startNext() {
    while (active < concurrency && pending.length) {
      const job = pending.shift();
      if (job.done) continue;
      active += 1;
      let worker;
      const finish = async (error, result) => {
        if (job.done) return;
        job.done = true;
        clearTimeout(job.timer);
        if (worker) await worker.terminate();
        active -= 1;
        if (error) job.reject(error); else job.resolve(result);
        startNext();
      };
      job.stop = () => void finish(new HttpError(504, 'Обработка занимает слишком долго. Уменьшите документ или выборку.'));
      try {
        worker = new Worker(new URL('./office-task-worker.mjs', import.meta.url), {
          workerData: job.data, transferList: job.transferList, resourceLimits: { maxOldGenerationSizeMb: 192 },
        });
        worker.once('message', ({ error, status, result }) => void finish(error ? new HttpError(Number.isInteger(status) ? status : 422, error) : null, result));
        worker.once('error', () => void finish(new HttpError(422, 'Не удалось обработать документ. Попробуйте уменьшить его размер.')));
        worker.once('exit', code => { if (!job.done) void finish(new HttpError(422, `Обработка документа прервана (${code})`)); });
      } catch (error) { void finish(error); }
    }
  }
  return (data, { transferInput = false } = {}) => new Promise((resolve, reject) => {
    if (active >= concurrency && pending.length >= maxQueued) {
      reject(new HttpError(429, 'Сервис обрабатывает документы. Повторите немного позже.')); return;
    }
    const { bytes } = data;
    const transferList = transferInput && bytes?.byteOffset === 0 && bytes?.byteLength === bytes?.buffer?.byteLength
      && bytes.buffer instanceof ArrayBuffer ? [bytes.buffer] : [];
    const job = { data, transferList, resolve, reject, done: false };
    job.timer = setTimeout(() => {
      if (job.stop) job.stop();
      else {
        job.done = true;
        const index = pending.indexOf(job);
        if (index >= 0) pending.splice(index, 1);
        job.data = null;
        job.transferList = [];
        reject(new HttpError(504, 'Время ожидания обработки истекло. Повторите позже.'));
      }
    }, timeoutMs);
    pending.push(job);
    startNext();
  });
}
export const runOfficeTask = createOfficeTaskRunner();
