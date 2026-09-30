import { apiClient, publicApiClient, supabaseClient, publicSupabaseClient } from "../../shared/api/client";
import { runRequest } from "../../shared/api/request";
export const EMBEDDING_QUERY_KEY = ["embedding-settings"] as const;
export const FAVICON_QUERY_KEY = ["app-favicon"] as const;
export type EmbeddingSettings = { allowed_origins: string[]; updated_at: string };
export type AppFavicon = { path: string | null; mime: string | null; updatedAt: string | null; url: string | null };

export function normalizeEmbeddingOrigin(value: string) {
  let url: URL;
  try { url = new URL(value.trim()); } catch { throw new Error("Укажите адрес сайта с https:// или http://"); }
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== "/"
    || url.hostname.length > 253 || !/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/.test(url.hostname)
    || url.port === "0") throw new Error("Нужен адрес сайта без пути, параметров и подстановок: https://example.ru");
  return url.origin;
}
export async function getEmbeddingSettings(): Promise<EmbeddingSettings> {
  const { data, error } = await runRequest("embedding.get", signal => apiClient.from("form_embedding_settings").select("allowed_origins,updated_at").eq("id",1).abortSignal(signal).single());
  if (error) throw error;
  return data as EmbeddingSettings;
}
export async function saveEmbeddingSettings(origins: string[]): Promise<EmbeddingSettings> {
  const values = origins.map(normalizeEmbeddingOrigin);
  if (values.length > 50) throw new Error("Можно добавить не более 50 сайтов");
  if (new Set(values).size !== values.length) throw new Error("В списке есть повторяющиеся сайты");
  const { data, error } = await runRequest("embedding.save", () => apiClient.rpc("set_form_embedding_origins",{p_origins:values}));
  if (error) throw error;
  return data as EmbeddingSettings;
}
function favicon(row: Omit<AppFavicon,"url"> | null): AppFavicon {
  const safePath = row?.path && /^favicon-[0-9a-f-]{36}\.(png|svg|ico)$/.test(row.path) ? row.path : null;
  return { path:safePath,mime:row?.mime ?? null,updatedAt:row?.updatedAt ?? null,
    url:safePath ? publicSupabaseClient.storage.from("app-favicons").getPublicUrl(safePath).data.publicUrl : null };
}
export async function getAppFavicon() {
  const { data, error } = await runRequest("favicon.get", signal => publicApiClient.rpc("get_app_favicon").abortSignal(signal));
  if (error) throw error;
  return favicon(data);
}
async function saveFavicon(payload: Record<string,unknown>) {
  const { data:{session} } = await apiClient.auth.getCurrentSession();
  if (!session?.access_token) throw new Error("Требуется авторизация");
  const { data,error,response } = await runRequest("favicon.save", (_signal,trace) => supabaseClient.functions.invoke("app-settings",{
    body:payload,headers:{...trace.headers,Authorization:`Bearer ${session.access_token}`},
  }),{timeoutMs:30_000});
  if (error) {
    const body=await response?.clone().json().catch(()=>null);
    throw new Error(body?.error ?? "Не удалось сохранить favicon");
  }
  return favicon(data);
}
export async function uploadAppFavicon(file: File) {
  await validateFaviconFile(file);
  const bytes=new Uint8Array(await file.arrayBuffer());
  let binary=""; for (let i=0;i<bytes.length;i+=8192) binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
  return saveFavicon({action:"upload-favicon",fileName:file.name,base64:btoa(binary)});
}
export const resetAppFavicon = () => saveFavicon({action:"reset-favicon"});
export const FAVICON_ACCEPT = ".png,.svg,.ico,image/png,image/svg+xml,image/x-icon,image/vnd.microsoft.icon";
export async function validateFaviconFile(file: File) {
  const extension=file.name.split('.').pop()?.toLowerCase();
  if (!extension || !["png","svg","ico"].includes(extension)) throw new Error("Поддерживаются только PNG, SVG и ICO");
  if (file.size<1 || file.size>1024*1024) throw new Error("Размер favicon должен быть от 1 байта до 1 МБ");
  const bytes=new Uint8Array(await file.arrayBuffer());
  const view=new DataView(bytes.buffer); let width=0,height=0,max=512;
  if(extension==="png") {
    if(bytes.length<24 || ![137,80,78,71,13,10,26,10].every((b,i)=>bytes[i]===b)) throw new Error("Повреждённый PNG-файл");
    width=view.getUint32(16);height=view.getUint32(20);
  } else if(extension==="ico") {
    if(bytes.length<22 || view.getUint16(0,true)!==0 || view.getUint16(2,true)!==1 || view.getUint16(4,true)<1) throw new Error("Повреждённый ICO-файл");
    width=bytes[6]||256;height=bytes[7]||256;max=256;
  } else {
    const text=new TextDecoder().decode(bytes);
    const document=new DOMParser().parseFromString(text,"image/svg+xml");
    const root=document.documentElement;
    if(root.localName!=="svg" || document.querySelector("parsererror") || /<!|&(?!amp;|lt;|gt;|quot;|apos;)/.test(text)) throw new Error("Некорректный SVG-файл");
    const allowed=new Set("svg g path rect circle ellipse line polyline polygon defs linearGradient radialGradient stop clipPath mask title desc".split(" "));
    for(const node of [root,...root.querySelectorAll("*")]) {
      if(!allowed.has(node.localName) || [...node.attributes].some(attr => /^on/i.test(attr.name) || /^(style|href|xlink:href)$/i.test(attr.name)
        || /url\s*\(/i.test(attr.value) && !/^url\(#[a-zA-Z0-9_-]+\)$/.test(attr.value))) throw new Error("SVG не должен содержать скрипты, стили и внешние ссылки");
    }
    const box=root.getAttribute("viewBox")?.trim().split(/[ ,]+/).map(Number);
    width=box?.length===4?box[2]:Number(root.getAttribute("width")?.replace(/px$/,""));
    height=box?.length===4?box[3]:Number(root.getAttribute("height")?.replace(/px$/,""));
  }
  if(!Number.isInteger(width)||width!==height||width<16||width>max) throw new Error(`Иконка должна быть квадратной, от 16 до ${max} пикселей`);
}
