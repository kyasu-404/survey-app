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

test("certificate verification is bypassed only by an explicit boolean opt-in", () => {
  for (const ssl_mode of ["tls", "starttls"]) {
    const settings = { host: "smtp.example.test", port: 465, ssl_mode, username: "test" };
    for (const allow_invalid_certificate of [undefined, false, null, "true", 1]) {
      assert.equal(createTransportOptions({ ...settings, allow_invalid_certificate }, "test").tls.rejectUnauthorized, true);
    }
    const options = createTransportOptions({ ...settings, allow_invalid_certificate: true }, "test");
    assert.equal(options.tls.rejectUnauthorized, false);
    assert.equal(options.tls.minVersion, "TLSv1.2");
    assert.equal(options.secure, ssl_mode === "tls");
    assert.equal(options.requireTLS, ssl_mode === "starttls");
    assert.equal(options.ignoreTLS, false);
  }
});

test("certificate failures wrapped in ESOCKET remain actionable without leaking server details", () => {
  for (const error of [
    { code: "ESOCKET", message: "self-signed certificate; password=secret" },
    { code: "DEPTH_ZERO_SELF_SIGNED_CERT" },
    { code: "CERT_HAS_EXPIRED" },
    { code: "ERR_TLS_CERT_ALTNAME_INVALID" },
    { code: "UNABLE_TO_VERIFY_LEAF_SIGNATURE" },
  ]) {
    const message = toPublicSmtpError(error);
    assert.match(message, /сертификат SMTP-сервера/);
    assert.match(message, /Не проверять сертификат сервера/);
    assert.doesNotMatch(message, /password|secret/);
  }
  assert.match(toPublicSmtpError({ code: "ESOCKET", message: "TLS handshake failed" }), /защищённое SMTP-соединение/);
  assert.equal(toPublicSmtpError({ code: "ECONNREFUSED" }), "Не удалось установить соединение с SMTP-сервером");
});
