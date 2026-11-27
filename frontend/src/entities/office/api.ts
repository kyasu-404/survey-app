import { sessionFetch, verifiedSession } from "../../shared/api/client";
import { runRequest } from "../../shared/api/request";
import { sessionErrorFromCode } from "../../shared/api/session";

export type OfficeDocument = {id:string;form_id:string;name:string;file_type?:'docx'|'xlsx';created_by:string;author_name?:string;updated_at:string;storage_path?:string;size_bytes:number;binding_count:number;last_save_error:string|null};
export type OfficeSettings = {enabled:boolean;public_url:string;internal_url:string;storage_url_override:string;jwt_header:string;jwt_prefix:string;max_file_mb:number;max_table_rows:number;has_secret:boolean};
export type EditorConfiguration = {config:Record<string,unknown>;apiJsUrl:string;name:string;embedOrigin?:string};

function requestOffice<T>(path: string, options: RequestInit, fallback: string, consume: (response: Response) => Promise<T>) {
  return runRequest("office.request", async (signal, trace) => {
    const headers = new Headers(options.headers);
    if (typeof options.body === "string" && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
    for (const [name, value] of Object.entries(trace.headers)) headers.set(name, value);
    const response = await sessionFetch(`/api/office${path}`, { ...options, headers, signal });
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      throw sessionErrorFromCode(body?.code)
        ?? Object.assign(new Error(body?.message || (response.status === 403 ? "Недостаточно прав для этой операции." : fallback)),
          { status: response.status });
    }
    return consume(response);
  }, { signal: options.signal ?? undefined, timeoutMs: 90_000 });
}

export function officeRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  return requestOffice(path, options, "Сервис документов временно недоступен", response => response.json() as Promise<T>);
}

async function download(path: string, name: string, fallback: string) {
  const blob = await requestOffice(path, {}, fallback, response => response.blob());
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export function downloadOfficeDocument(doc: Pick<OfficeDocument, "id" | "name">) {
  return download(`/documents/${doc.id}/download`, doc.name, "Не удалось скачать файл");
}

export type OfficeResult={id:string;form_id:string;template_id:string|null;name:string;file_type:'docx'|'xlsx';files:string[];size_bytes:number;created_by:string;created_at:string;author_name?:string};
export type OfficeJob={id:string;form_id:string;name:string;state:'queued'|'running'|'succeeded'|'failed';error?:string|null;created_at:string};

export async function generateOfficeDocuments(doc:Pick<OfficeDocument,'id'|'name'>,responseIds?:string[],nameQuestionId?:string):Promise<OfficeJob> {
  return officeRequest<OfficeJob>(`/documents/${doc.id}/generate`,{method:'POST',body:JSON.stringify({response_ids:responseIds,name_question_id:nameQuestionId})});
}

export function downloadOfficeResult(result: OfficeResult, index?: number) {
  return download(`/results/${result.id}/${index === undefined ? "download" : `files/${index}`}`,
    index === undefined ? result.name : result.files[index], "Не удалось скачать результат");
}

// Ticket issuance changes server state. Validate the token before issuing it.
export async function getOfficeArchiveAuthorization(signal: AbortSignal) {
  const { session } = await runRequest("office.validateArchiveSession", () => verifiedSession(), { signal });
  return `Bearer ${session.access_token}`;
}
