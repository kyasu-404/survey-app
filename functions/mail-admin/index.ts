import { createClient } from "https://esm.sh/@supabase/supabase-js@2.110.7";
import { buildReminderMail, getOrganizationMailName } from "./mailContent.mjs";

type RequestProfile = {
  id: string;
  name: string;
  email: string;
  role: "admin" | "user";
  is_disabled: boolean;
};

type MailSettingsRow = {
  id: number;
  enabled: boolean;
  host: string;
  port: number;
  ssl_mode: "tls" | "starttls" | "none";
  username: string;
  password_encrypted: string;
  from_email: string;
  from_name: string;
  reply_to: string | null;
  updated_at: string;
};

type OrganizationRow = {
  id: string;
  organization_type: string;
  number: string | null;
  alias: string;
  email: string;
};

const baseCorsHeaders = {
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-request-id, traceparent, x-client-release",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
  "Vary": "Origin",
};
const defaultAllowedOrigins = new Set(["http://localhost:5173", "http://127.0.0.1:5173"]);
const defaultAllowedDevelopmentPorts = new Set(["3000", "4173", "5173", "8000"]);
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function getAllowedOrigins() {
  const configured = Deno.env.get("MAIL_ADMIN_ALLOWED_ORIGINS")
    ?.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  return new Set(configured?.length ? configured : defaultAllowedOrigins);
}

function isPrivateNetworkHostname(hostname: string) {
  return /^10\./.test(hostname)
    || /^192\.168\./.test(hostname)
    || /^172\.(1[6-9]|2\d|3[0-1])\./.test(hostname);
}

function isDefaultLocalDevelopmentOrigin(origin: string) {
  try {
    const url = new URL(origin);
    const hostname = url.hostname.replace(/^\[|\]$/g, "");
    const isLoopback = hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
    return (url.protocol === "http:" || url.protocol === "https:")
      && defaultAllowedDevelopmentPorts.has(url.port)
      && (isLoopback || isPrivateNetworkHostname(hostname));
  } catch {
    return false;
  }
}

function isOriginAllowed(origin: string | null) {
  return !origin || getAllowedOrigins().has(origin) || isDefaultLocalDevelopmentOrigin(origin);
}

function corsHeaders(req: Request) {
  const origin = req.headers.get("Origin");
  return origin && isOriginAllowed(origin)
    ? { ...baseCorsHeaders, "Access-Control-Allow-Origin": origin }
    : baseCorsHeaders;
}

function json(req: Request, status: number, body: Record<string, unknown>, requestId: string) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req), "Content-Type": "application/json", "x-request-id": requestId },
  });
}

function getBearerToken(req: Request) {
  const authorization = req.headers.get("Authorization") ?? "";
  return authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asTrimmedString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function publicSettings(row: MailSettingsRow | null) {
  if (!row) return null;
  return {
    enabled: row.enabled,
    host: row.host,
    port: row.port,
    sslMode: row.ssl_mode,
    username: row.username,
    fromEmail: row.from_email,
    fromName: row.from_name,
    replyTo: row.reply_to ?? "",
    hasPassword: Boolean(row.password_encrypted),
    updatedAt: row.updated_at,
  };
}

function validateSettings(payload: Record<string, unknown>, hasStoredPassword: boolean) {
  const enabled = payload.enabled !== false;
  const host = asTrimmedString(payload.host);
  const port = Number(payload.port);
  const sslMode = asTrimmedString(payload.sslMode);
  const username = asTrimmedString(payload.username);
  const password = typeof payload.password === "string" ? payload.password : "";
  const fromEmail = asTrimmedString(payload.fromEmail).toLowerCase();
  const fromName = asTrimmedString(payload.fromName);
  const replyTo = asTrimmedString(payload.replyTo).toLowerCase();

  if (!host || host.length > 253 || /[\s/:]/.test(host)) return { error: "Укажите SMTP-сервер без протокола и пробелов" };
  if (!Number.isInteger(port) || port < 1 || port > 65535) return { error: "Порт SMTP должен быть числом от 1 до 65535" };
  if (!new Set(["tls", "starttls", "none"]).has(sslMode)) return { error: "Выберите корректный режим шифрования" };
  if (!username || username.length > 320 || /[\r\n]/.test(username)) return { error: "Укажите имя пользователя SMTP" };
  if (!password && !hasStoredPassword) return { error: "Укажите пароль SMTP" };
  if (password.length > 4096) return { error: "Пароль SMTP слишком длинный" };
  if (!emailPattern.test(fromEmail) || fromEmail.length > 320) return { error: "Укажите корректный email отправителя" };
  if (!fromName || fromName.length > 200 || /[\r\n]/.test(fromName)) return { error: "Укажите имя отправителя" };
  if (replyTo && (!emailPattern.test(replyTo) || replyTo.length > 320)) return { error: "Укажите корректный Reply-To" };

  return {
    value: { enabled, host, port, sslMode, username, password, fromEmail, fromName, replyTo: replyTo || null },
  };
}

function decodeEncryptionKey() {
  const encoded = Deno.env.get("MAIL_SETTINGS_ENCRYPTION_KEY")?.trim() ?? "";
  try {
    const bytes = Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
    return bytes.length === 32 ? bytes : null;
  } catch {
    return null;
  }
}

function toBase64(bytes: Uint8Array) {
  let binary = "";
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary);
}

async function encryptPassword(password: string) {
  const keyBytes = decodeEncryptionKey();
  if (!keyBytes) throw new Error("MAIL_SETTINGS_ENCRYPTION_KEY должен содержать Base64-ключ длиной 32 байта");
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "AES-GCM" }, false, ["encrypt"]);
  const encrypted = new Uint8Array(await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(password),
  ));
  return `v1:${toBase64(iv)}:${toBase64(encrypted)}`;
}

function getAppBaseUrl(req: Request) {
  const configured = Deno.env.get("PUBLIC_APP_URL")?.trim();
  const candidate = configured || req.headers.get("Origin") || "";
  try {
    const url = new URL(candidate);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.origin;
  } catch {
    return null;
  }
}

async function insertJobs(adminClient: ReturnType<typeof createClient>, jobs: Record<string, unknown>[]) {
  for (let index = 0; index < jobs.length; index += 500) {
    const { error } = await adminClient.from("mail_queue").insert(jobs.slice(index, index + 500));
    if (error) throw error;
  }
}

Deno.serve(async (req) => {
  const requestId = req.headers.get("x-request-id") ?? crypto.randomUUID();
  const origin = req.headers.get("Origin");

  if (!isOriginAllowed(origin)) return json(req, 403, { error: "Origin не разрешён" }, requestId);
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(req) });
  if (req.method !== "POST") return json(req, 405, { error: "Метод не поддерживается" }, requestId);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const jwt = getBearerToken(req);
  if (!supabaseUrl || !anonKey || !serviceRoleKey) return json(req, 500, { error: "Функция почты не настроена" }, requestId);
  if (!jwt) return json(req, 401, { error: "Требуется авторизация" }, requestId);

  let payload: Record<string, unknown>;
  try {
    const parsed = await req.json();
    if (!isRecord(parsed)) throw new Error("invalid");
    payload = parsed;
  } catch {
    return json(req, 400, { error: "Некорректное тело запроса" }, requestId);
  }

  const authClient = createClient(supabaseUrl, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const adminClient = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: userData, error: userError } = await authClient.auth.getUser(jwt);
  if (userError || !userData.user) return json(req, 401, { error: "Сессия недействительна" }, requestId);

  const { data: profileData, error: profileError } = await adminClient
    .from("profiles")
    .select("id, name, email, role, is_disabled")
    .eq("id", userData.user.id)
    .single();
  const profile = profileData as RequestProfile | null;
  if (profileError || !profile || profile.is_disabled) return json(req, 403, { error: "Доступ запрещён" }, requestId);

  const action = asTrimmedString(payload.action);
  console.info("mail-admin action started", { requestId, action, requesterId: profile.id });

  try {
    if (action === "get-settings") {
      if (profile.role !== "admin") return json(req, 403, { error: "Настройки доступны только администратору" }, requestId);
      const { data, error } = await adminClient.from("mail_settings").select("*").eq("id", 1).maybeSingle();
      if (error) throw error;
      return json(req, 200, { settings: publicSettings(data as MailSettingsRow | null) }, requestId);
    }

    if (action === "save-settings") {
      if (profile.role !== "admin") return json(req, 403, { error: "Настройки доступны только администратору" }, requestId);
      const { data: existingData, error: existingError } = await adminClient
        .from("mail_settings")
        .select("*")
        .eq("id", 1)
        .maybeSingle();
      if (existingError) throw existingError;
      const existing = existingData as MailSettingsRow | null;
      const validation = validateSettings(payload, Boolean(existing?.password_encrypted));
      if (validation.error || !validation.value) return json(req, 400, { error: validation.error ?? "Проверьте настройки" }, requestId);
      const settings = validation.value;
      const passwordEncrypted = settings.password
        ? await encryptPassword(settings.password)
        : existing!.password_encrypted;
      const { data, error } = await adminClient.from("mail_settings").upsert({
        id: 1,
        enabled: settings.enabled,
        host: settings.host,
        port: settings.port,
        ssl_mode: settings.sslMode,
        username: settings.username,
        password_encrypted: passwordEncrypted,
        from_email: settings.fromEmail,
        from_name: settings.fromName,
        reply_to: settings.replyTo,
        updated_by: profile.id,
      }).select("*").single();
      if (error) throw error;
      return json(req, 200, { settings: publicSettings(data as MailSettingsRow) }, requestId);
    }

    if (action === "queue-test") {
      if (profile.role !== "admin") return json(req, 403, { error: "Проверка SMTP доступна только администратору" }, requestId);
      const recipientEmail = asTrimmedString(payload.recipientEmail).toLowerCase();
      if (!emailPattern.test(recipientEmail) || recipientEmail.length > 320) {
        return json(req, 400, { error: "Укажите корректный адрес для тестового письма" }, requestId);
      }
      const { data: settings, error: settingsError } = await adminClient
        .from("mail_settings")
        .select("enabled")
        .eq("id", 1)
        .maybeSingle();
      if (settingsError) throw settingsError;
      if (!settings?.enabled) return json(req, 409, { error: "Сначала сохраните и включите SMTP-коннектор" }, requestId);

      const batchId = crypto.randomUUID();
      const { error: batchError } = await adminClient.from("mail_batches").insert({
        id: batchId,
        kind: "test",
        form_id: null,
        created_by: profile.id,
        total_count: 1,
      });
      if (batchError) throw batchError;
      try {
        await insertJobs(adminClient, [{
          batch_id: batchId,
          form_id: null,
          organization_id: null,
          recipient_email: recipientEmail,
          recipient_name: profile.name || recipientEmail,
          subject: "Проверка SMTP — Формы",
          body_text: "SMTP-коннектор настроен. Это тестовое письмо из приложения «Формы».",
        }]);
      } catch (error) {
        await adminClient.from("mail_batches").delete().eq("id", batchId);
        throw error;
      }
      return json(req, 202, { batchId, queuedCount: 1 }, requestId);
    }

    if (action === "queue-reminders") {
      const formId = asTrimmedString(payload.formId);
      if (!uuidPattern.test(formId)) return json(req, 400, { error: "Некорректный идентификатор формы" }, requestId);
      const { data: form, error: formError } = await adminClient
        .from("forms")
        .select("id, title, deadline_at, author_id")
        .eq("id", formId)
        .maybeSingle();
      if (formError) throw formError;
      if (!form) return json(req, 404, { error: "Форма не найдена" }, requestId);
      if (form.author_id !== profile.id && profile.role !== "admin") return json(req, 403, { error: "Нет прав на рассылку по этой форме" }, requestId);

      const { data: settings, error: settingsError } = await adminClient
        .from("mail_settings")
        .select("enabled")
        .eq("id", 1)
        .maybeSingle();
      if (settingsError) throw settingsError;
      if (!settings?.enabled) return json(req, 409, { error: "SMTP-коннектор не настроен или выключен" }, requestId);

      const { data: activeJob, error: activeJobError } = await adminClient
        .from("mail_queue")
        .select("id")
        .eq("form_id", formId)
        .in("status", ["queued", "processing"])
        .limit(1)
        .maybeSingle();
      if (activeJobError) throw activeJobError;
      if (activeJob) return json(req, 409, { error: "Предыдущая рассылка по этой форме ещё выполняется" }, requestId);

      const appBaseUrl = getAppBaseUrl(req);
      if (!appBaseUrl) return json(req, 500, { error: "Для ссылок в письмах задайте PUBLIC_APP_URL" }, requestId);
      const { data: missingData, error: missingError } = await adminClient.rpc("list_missing_form_organizations", { p_form_id: formId });
      if (missingError) throw missingError;
      const missing = (missingData ?? []) as OrganizationRow[];
      if (missing.length === 0) return json(req, 200, { batchId: null, queuedCount: 0 }, requestId);
      if (missing.length > 5000) return json(req, 409, { error: "За одну рассылку можно поставить в очередь не более 5000 писем" }, requestId);
      const invalidRecipient = missing.find((organization) => !emailPattern.test(organization.email) || organization.email.length > 320);
      if (invalidRecipient) {
        return json(req, 409, {
          error: `Исправьте email в справочнике для организации «${getOrganizationMailName(invalidRecipient)}»`,
        }, requestId);
      }

      const batchId = crypto.randomUUID();
      const { error: batchError } = await adminClient.from("mail_batches").insert({
        id: batchId,
        kind: "reminder",
        form_id: formId,
        created_by: profile.id,
        total_count: missing.length,
      });
      if (batchError) throw batchError;
      const formUrl = new URL(`/form/${formId}`, appBaseUrl).toString();
      const jobs = missing.map((organization) => {
        const recipientName = getOrganizationMailName(organization);
        const content = buildReminderMail({
          organizationName: recipientName,
          formTitle: form.title,
          deadlineAt: form.deadline_at,
          formUrl,
        });
        return {
          batch_id: batchId,
          form_id: formId,
          organization_id: organization.id,
          recipient_email: organization.email.toLowerCase(),
          recipient_name: recipientName,
          subject: content.subject,
          body_text: content.bodyText,
        };
      });
      try {
        await insertJobs(adminClient, jobs);
      } catch (error) {
        await adminClient.from("mail_batches").delete().eq("id", batchId);
        throw error;
      }
      return json(req, 202, { batchId, queuedCount: jobs.length }, requestId);
    }

    return json(req, 400, { error: "Неизвестное действие" }, requestId);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Неизвестная ошибка";
    console.error("mail-admin action failed", { requestId, action, message });
    return json(req, 500, { error: "Не удалось выполнить операцию с почтой" }, requestId);
  }
});
