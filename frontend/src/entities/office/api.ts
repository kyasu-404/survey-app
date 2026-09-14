import { apiClient } from '../../shared/api';
export type OfficeDocument = {id:string;form_id:string;name:string;file_type?:'docx'|'xlsx';created_by:string;author_name?:string;updated_at:string;size_bytes:number;binding_count:number;last_save_error:string|null};
export type OfficeSettings = {enabled:boolean;public_url:string;internal_url:string;storage_url_override:string;jwt_header:string;jwt_prefix:string;max_file_mb:number;max_table_rows:number;has_secret:boolean};
export type EditorConfiguration = {config:Record<string,unknown>;apiJsUrl:string;name:string};
export async function officeRequest<T>(path:string, options:RequestInit = {}):Promise<T> {
  const {data:{session}} = await apiClient.auth.getCurrentSession();
  if(!session?.access_token) throw new Error('Сессия истекла. Войдите снова.');
  const response = await fetch(`/api/office${path}`, {...options,headers:{...(typeof options.body==='string' ? {'Content-Type':'application/json'} : {}),...options.headers,Authorization:`Bearer ${session.access_token}`},signal:options.signal || AbortSignal.timeout(90000)});
  if(!response.ok) {
    const body=await response.json().catch(()=>null) as {message?:string}|null;
    throw new Error(body?.message || 'Сервис документов временно недоступен');
  }
  return response.json() as Promise<T>;
}
export async function downloadOfficeDocument(doc:Pick<OfficeDocument,'id'|'name'>) {
  const {data:{session}}=await apiClient.auth.getCurrentSession();
  if(!session?.access_token) throw new Error('Сессия истекла');
  const response=await fetch(`/api/office/documents/${doc.id}/download`,{headers:{Authorization:`Bearer ${session.access_token}`},signal:AbortSignal.timeout(90000)});
  if(!response.ok) throw new Error('Не удалось скачать файл');
  const url=URL.createObjectURL(await response.blob());
  const link=document.createElement('a');link.href=url;link.download=doc.name;link.click();
  setTimeout(()=>URL.revokeObjectURL(url),60000);
}

export type OfficeResult={id:string;form_id:string;template_id:string|null;name:string;file_type:'docx'|'xlsx';files:string[];size_bytes:number;created_by:string;created_at:string;author_name?:string};
export async function generateOfficeDocuments(doc:Pick<OfficeDocument,'id'|'name'>,responseIds?:string[],nameQuestionId?:string):Promise<OfficeResult> {
  return officeRequest<OfficeResult>(`/documents/${doc.id}/generate`,{method:'POST',body:JSON.stringify({response_ids:responseIds,name_question_id:nameQuestionId})});
}
export async function downloadOfficeResult(result:OfficeResult,index?:number){
  const {data:{session}}=await apiClient.auth.getCurrentSession();if(!session?.access_token)throw new Error('Сессия истекла');
  const response=await fetch(`/api/office/results/${result.id}/${index===undefined?'download':`files/${index}`}`,{headers:{Authorization:`Bearer ${session.access_token}`},signal:AbortSignal.timeout(90000)});
  if(!response.ok)throw new Error('Не удалось скачать результат');
  const url=URL.createObjectURL(await response.blob()),link=document.createElement('a');link.href=url;link.download=index===undefined?result.name:result.files[index];link.click();setTimeout(()=>URL.revokeObjectURL(url),60000);
}
