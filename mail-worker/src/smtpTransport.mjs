import nodemailer from "nodemailer";
import { createTransportOptions, decryptPassword } from "./config.mjs";

// Retain authenticated connections across polling batches. Sender/reply-to are
// message options; only a change to the SMTP connection requires a new pool.
export function createSmtpTransportManager({ encryptionKey, concurrency, createTransport = nodemailer.createTransport }) {
  let transporter = null;
  let connectionKey = null;
  const close = () => {
    transporter?.close();
    transporter = null;
    connectionKey = null;
  };
  return {
    close,
    get(settings) {
      if (!settings?.enabled) { close(); return null; }
      const nextKey = JSON.stringify([
        settings.host, settings.port, settings.ssl_mode, settings.username, settings.password_encrypted,
      ]);
      if (nextKey !== connectionKey) {
        close();
        const password = decryptPassword(settings.password_encrypted, encryptionKey);
        transporter = createTransport({
          ...createTransportOptions(settings, password),
          pool: true,
          maxConnections: concurrency,
          maxMessages: 100,
        });
        connectionKey = nextKey;
      }
      return transporter;
    },
  };
}
