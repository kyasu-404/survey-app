import assert from "node:assert/strict";
import { createCipheriv, randomBytes } from "node:crypto";
import test from "node:test";
import { createTransportOptions, decryptPassword, toPublicSmtpError } from "../src/config.mjs";

function encryptLikeEdgeFunction(password, key) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(password, "utf8"), cipher.final(), cipher.getAuthTag()]);
  return `v1:${iv.toString("base64")}:${encrypted.toString("base64")}`;
}

test("decrypts the AES-GCM password format produced by mail-admin", () => {
  const key = randomBytes(32);
  const serialized = encryptLikeEdgeFunction("пароль-123", key);
  assert.equal(decryptPassword(serialized, key.toString("base64")), "пароль-123");
});

test("maps SMTP encryption modes to nodemailer", () => {
  const base = { host: "smtp.example.ru", port: 465, username: "mail@example.ru" };
  assert.equal(createTransportOptions({ ...base, ssl_mode: "tls" }, "secret").secure, true);
  assert.equal(createTransportOptions({ ...base, ssl_mode: "starttls" }, "secret").requireTLS, true);
  assert.equal(createTransportOptions({ ...base, ssl_mode: "none" }, "secret").ignoreTLS, true);
});

test("returns actionable errors without exposing SMTP responses", () => {
  assert.equal(toPublicSmtpError({ code: "EAUTH", message: "secret leaked" }), "SMTP-сервер отклонил имя пользователя или пароль");
  assert.equal(toPublicSmtpError({ code: "ETIMEDOUT" }), "SMTP-сервер не ответил вовремя");
  assert.doesNotMatch(toPublicSmtpError({ message: "password=hunter2" }), /hunter2/);
});
