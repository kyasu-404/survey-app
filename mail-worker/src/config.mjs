import { createDecipheriv } from "node:crypto";

export function parsePublicAppOrigin(value) {
  const url = String(value ?? "").trim();
  // Keep the origin passed to process_automations within the database contract.
  if (!/^https?:\/\/[A-Za-z0-9.-]+(?::[0-9]{1,5})?\/?$/.test(url)) return null;
  try {
    const { origin, port } = new URL(url);
    return port !== "0" && origin.length <= 300 ? origin : null;
  } catch {
    return null;
  }
}

export function parseBoundedInteger(value, fallback, min, max) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed !== 0
    ? Math.min(max, Math.max(min, Math.trunc(parsed)))
    : fallback;
}

export function decryptPassword(serialized, base64Key, context = null) {
  const parts = String(serialized ?? "").split(":");
  const version = parts[0];
  if (parts.length !== 3 || (version !== "v1" && version !== "v2")) {
    throw new Error("Неподдерживаемый формат SMTP-пароля");
  }

  const key = Buffer.from(String(base64Key ?? ""), "base64");
  const iv = Buffer.from(parts[1], "base64");
  const encryptedWithTag = Buffer.from(parts[2], "base64");
  if (key.length !== 32 || iv.length !== 12 || encryptedWithTag.length < 17) {
    throw new Error("Некорректный ключ или зашифрованный SMTP-пароль");
  }

  const authTag = encryptedWithTag.subarray(encryptedWithTag.length - 16);
  const encrypted = encryptedWithTag.subarray(0, encryptedWithTag.length - 16);
  const decipher = createDecipheriv("aes-256-gcm", key, iv, { authTagLength: 16 });
  if (version === "v2") {
    if (!context || typeof context.host !== "string" || !Number.isInteger(Number(context.port)) || typeof context.username !== "string") {
      throw new Error("Отсутствует контекст SMTP для расшифровки пароля");
    }
    decipher.setAAD(Buffer.from(`smtp:${context.host.toLowerCase()}:${context.port}:${context.username}`, "utf8"));
  }
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}

export function createTransportOptions(settings, password) {
  const mode = settings.ssl_mode;
  return {
    host: settings.host,
    port: settings.port,
    secure: mode === "tls",
    requireTLS: mode === "starttls",
    ignoreTLS: mode === "none",
    auth: { user: settings.username, pass: password },
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 30_000,
    tls: { rejectUnauthorized: settings.allow_invalid_certificate !== true, minVersion: "TLSv1.2" },
    disableFileAccess: true,
    disableUrlAccess: true,
  };
}

export function toPublicSmtpError(error) {
  const code = String(error?.code ?? "").toUpperCase();
  const responseCode = Number(error?.responseCode);
  const message = String(error?.message ?? "").toLowerCase();

  if (code === "EAUTH" || responseCode === 535) return "SMTP-сервер отклонил имя пользователя или пароль";
  if (code === "EDNS") return "Не удалось найти SMTP-сервер по указанному адресу";
  if (code === "ETIMEDOUT" || message.includes("timeout")) return "SMTP-сервер не ответил вовремя";
  if (code.includes("CERT") || code === "UNABLE_TO_VERIFY_LEAF_SIGNATURE"
    || message.includes("certificate") || message.includes("self-signed")) {
    return "Не удалось проверить сертификат SMTP-сервера. Проверьте сертификат или включите «Не проверять сертификат сервера» в настройках SMTP.";
  }
  if (message.includes("tls") || message.includes("ssl")) {
    return "Не удалось установить защищённое SMTP-соединение; проверьте порт и режим шифрования";
  }
  if (["ECONNECTION", "ECONNREFUSED", "ENETUNREACH", "ESOCKET"].includes(code)) {
    return "Не удалось установить соединение с SMTP-сервером";
  }
  if (responseCode >= 500 && responseCode < 600) return `SMTP-сервер отклонил письмо (код ${responseCode})`;
  if (responseCode >= 400 && responseCode < 500) return `SMTP-сервер временно не принял письмо (код ${responseCode})`;
  return "Не удалось отправить письмо через SMTP";
}
