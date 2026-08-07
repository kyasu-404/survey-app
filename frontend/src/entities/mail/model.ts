import type { MailDeliveryStatus, MailJob, SmtpSettingsDraft } from "./types";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const EMPTY_SMTP_SETTINGS: SmtpSettingsDraft = {
  enabled: true,
  host: "",
  port: 465,
  sslMode: "tls",
  username: "",
  password: "",
  fromEmail: "",
  fromName: "Формы",
  replyTo: "",
};

export const MAIL_STATUS_LABELS: Record<MailDeliveryStatus, string> = {
  queued: "В очереди",
  processing: "Отправляется",
  sent: "Отправлено",
  failed: "Ошибка",
};

export function validateSmtpSettings(draft: SmtpSettingsDraft, hasStoredPassword: boolean) {
  if (!draft.host.trim() || draft.host.length > 253 || /[\s/:]/.test(draft.host)) {
    return "Укажите SMTP-сервер без протокола и пробелов";
  }
  if (!Number.isInteger(draft.port) || draft.port < 1 || draft.port > 65535) {
    return "Порт SMTP должен быть числом от 1 до 65535";
  }
  if (!draft.username.trim() || /[\r\n]/.test(draft.username)) return "Укажите имя пользователя SMTP";
  if (!draft.password && !hasStoredPassword) return "Укажите пароль SMTP";
  if (!EMAIL_PATTERN.test(draft.fromEmail.trim())) return "Укажите корректный email отправителя";
  if (!draft.fromName.trim() || /[\r\n]/.test(draft.fromName)) return "Укажите имя отправителя";
  if (draft.replyTo.trim() && !EMAIL_PATTERN.test(draft.replyTo.trim())) return "Укажите корректный Reply-To";
  return null;
}

export function getMailProgress(jobs: MailJob[]) {
  return jobs.reduce(
    (progress, job) => ({ ...progress, [job.status]: progress[job.status] + 1 }),
    { queued: 0, processing: 0, sent: 0, failed: 0 } as Record<MailDeliveryStatus, number>,
  );
}
