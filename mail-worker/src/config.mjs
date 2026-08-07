import { createDecipheriv } from "node:crypto";

export function decryptPassword(serialized, base64Key) {
  const parts = String(serialized ?? "").split(":");
  if (parts.length !== 3 || parts[0] !== "v1") {
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
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
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
    tls: { rejectUnauthorized: true, minVersion: "TLSv1.2" },
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
  if (["ECONNECTION", "ECONNREFUSED", "ENETUNREACH", "ESOCKET"].includes(code)) {
    return "Не удалось установить соединение с SMTP-сервером";
  }
  if (message.includes("certificate") || message.includes("tls") || message.includes("ssl")) {
    return "Не удалось установить защищённое SMTP-соединение; проверьте порт и режим шифрования";
  }
  if (responseCode >= 500 && responseCode < 600) return `SMTP-сервер отклонил письмо (код ${responseCode})`;
  if (responseCode >= 400 && responseCode < 500) return `SMTP-сервер временно не принял письмо (код ${responseCode})`;
  return "Не удалось отправить письмо через SMTP";
}
