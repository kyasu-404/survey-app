import { createClient } from "npm:@supabase/supabase-js@2.110.7";
import { XMLParser, XMLValidator, XMLBuilder } from "npm:fast-xml-parser@5.11.1";
import { validateFavicon, MAX_FAVICON_BYTES } from "./favicon.mjs";

const cors = { "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-request-id, traceparent, x-client-release", "Access-Control-Allow-Methods": "POST, OPTIONS", "Vary": "Origin" };
Deno.serve(async req => {
  const origin = req.headers.get("Origin");
  const allowed = (Deno.env.get("MAIL_ADMIN_ALLOWED_ORIGINS") ?? "https://forms.imc-mosk.ru,http://localhost:5173,http://127.0.0.1:5173").split(",").map(value => value.trim());
  const headers = { ...cors, ...(origin && allowed.includes(origin) ? { "Access-Control-Allow-Origin": origin } : {}), "Content-Type": "application/json", "Cache-Control": "no-store" };
  const json = (status: number, data: unknown) => new Response(JSON.stringify(data), { status, headers });
  if (origin && !allowed.includes(origin)) return json(403, { error: "Origin не разрешён" });
  if (req.method === "OPTIONS") return new Response("ok", { headers });
  if (req.method !== "POST") return json(405, { error: "Метод не поддерживается" });
  const token = req.headers.get("Authorization")?.replace(/^Bearer /, "");
  if (!token) return json(401, { error: "Требуется авторизация" });
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false, autoRefreshToken: false } });
  try {
    const { data: auth, error: authError } = await admin.auth.getUser(token);
    if (authError || !auth.user) return json(401, { error: "Сессия недействительна" });
    const { data: profile, error: profileError } = await admin.from("profiles").select("role,is_disabled").eq("id",auth.user.id).single();
    if (profileError || profile?.role !== "admin" || profile.is_disabled) return json(403, { error: "Настройки доступны только администратору" });
    // Bound actual streamed bytes, not just the untrusted Content-Length header.
    const reader = req.body?.getReader(); let size=0; const chunks: Uint8Array[]=[];
    if (reader) while (true) { const { value, done } = await reader.read(); if (done) break; size+=value.length;
      if (size > Math.ceil(MAX_FAVICON_BYTES*4/3)+8192) { await reader.cancel(); return json(413,{error:"Файл слишком большой: не более 1 МБ"}); } chunks.push(value); }
    const bytes = new Uint8Array(size); let offset=0; for (const chunk of chunks) { bytes.set(chunk,offset); offset+=chunk.length; }
    let payload;
    try { payload=JSON.parse(new TextDecoder().decode(bytes)); } catch { return json(400,{error:"Некорректный запрос"}); }
    if (!payload || !["upload-favicon","reset-favicon"].includes(payload.action)) return json(400,{error:"Неизвестное действие"});
    let path: string|null=null; let mime: string|null=null;
    if (payload.action === "upload-favicon") {
      let validated;
      try {
        if (typeof payload.base64 !== "string" || !/^[A-Za-z0-9+/]*={0,2}$/.test(payload.base64)) throw new Error("Некорректный файл");
        const decoded=Uint8Array.from(atob(payload.base64),c=>c.charCodeAt(0));
        validated=validateFavicon(decoded,payload.fileName,{XMLParser,XMLValidator,XMLBuilder});
      } catch (error) { return json(400,{error:error instanceof Error ? error.message : "Некорректный файл"}); }
      path=`favicon-${crypto.randomUUID()}.${validated.extension}`; mime=validated.mime;
      const { error } = await admin.storage.from("app-favicons").upload(path,validated.bytes,{contentType:mime!,cacheControl:"31536000",upsert:false});
      if (error) throw error;
    }
    const { data, error } = await admin.rpc("set_app_favicon",{p_path:path,p_mime:mime,p_actor:auth.user.id});
    if (error) { if(path) await admin.storage.from("app-favicons").remove([path]); throw error; }
    if (data.previousPath) {
      const { error: cleanupError }=await admin.storage.from("app-favicons").remove([data.previousPath]);
      if(cleanupError) console.error("Previous favicon cleanup failed",{message:cleanupError.message});
    }
    return json(200,{path:data.path,mime:data.mime,updatedAt:data.updatedAt});
  } catch (error) { console.error("app-settings failed", { message:error instanceof Error ? error.message : "unknown" }); return json(500,{error:"Не удалось сохранить favicon"}); }
});
