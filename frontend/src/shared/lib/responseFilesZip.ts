import JSZip from "jszip";
import { downloadSurveyFile } from "../api/storage";
import type { SurveySchema } from "../../entities/survey/types";
import type { SurveyResponse } from "../../entities/response/types";
import { collectResponseAttachments, safeArchiveName } from "./responseFiles";

type ExportOptions = { signal?: AbortSignal; onProgress?: (completed: number, total: number) => void };

export async function createResponseFilesZip(responses: SurveyResponse[], schema: SurveySchema, options: ExportOptions = {}) {
  options.signal?.throwIfAborted();
  const attachments = collectResponseAttachments(responses, schema);
  if (!attachments.length) return null;
  const zip = new JSZip();
  const failed: string[] = [];
  let completed = 0;
  let cursor = 0;
  options.onProgress?.(0, attachments.length);
  // Bound concurrent downloads instead of issuing one request per file at once.
  await Promise.all(Array.from({ length: Math.min(3, attachments.length) }, async () => {
    while (cursor < attachments.length) {
      options.signal?.throwIfAborted();
      const attachment = attachments[cursor++];
      try {
        const blob = await downloadSurveyFile(attachment.value, { signal: options.signal });
        const bytes = new Uint8Array(await blob.arrayBuffer());
        options.signal?.throwIfAborted();
        zip.file(attachment.archivePath, bytes, { createFolders: false });
      } catch {
        options.signal?.throwIfAborted();
        failed.push(attachment.archivePath);
      }
      options.onProgress?.(++completed, attachments.length);
    }
  }));
  if (failed.length === attachments.length) throw new Error("Не удалось скачать вложения. Проверьте доступ к файлам и попробуйте снова.");
  if (failed.length) {
    zip.file("Не удалось скачать.txt", `Не удалось получить ${failed.length} из ${attachments.length} файлов. Повторите выгрузку или проверьте доступ к вложениям.\r\n\r\n${failed.sort().join("\r\n")}`);
  }
  options.signal?.throwIfAborted();
  const blob = await zip.generateAsync({ type: "blob", compression: "STORE" }, () => options.signal?.throwIfAborted());
  return { blob, downloaded: attachments.length - failed.length, failed: failed.length };
}

export async function exportResponseFilesZip(responses: SurveyResponse[], schema: SurveySchema, title: string, options: ExportOptions = {}) {
  const result = await createResponseFilesZip(responses, schema, options);
  if (!result) return null;
  options.signal?.throwIfAborted();
  const url = URL.createObjectURL(result.blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `Файлы-${safeArchiveName(title, "форма")}.zip`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return { downloaded: result.downloaded, failed: result.failed };
}
