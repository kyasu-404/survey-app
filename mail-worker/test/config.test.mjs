import assert from "node:assert/strict";
import { createCipheriv, randomBytes } from "node:crypto";
import test from "node:test";
import { createTransportOptions, decryptPassword, parseBoundedInteger, parsePublicAppOrigin, toPublicSmtpError } from "../src/config.mjs";

test("uses only HTTP origins supported by automation email links", () => {
  assert.equal(parsePublicAppOrigin("https://forms.example.ru/"), "https://forms.example.ru");
  assert.equal(parsePublicAppOrigin("  https://forms.example.ru/  "), "https://forms.example.ru");
  assert.equal(parsePublicAppOrigin("http://localhost:5173"), "http://localhost:5173");
  for (const value of [
    "", "forms.example.ru", "ftp://forms.example.ru", "https://user@example.ru",
    "http://[::1]:5173", "http://localhost:99999", "https://example.ru/path",
    "http://localhost:0", "https://forms.example.ru:00000/",
    "https://example.ru?q", "https://example.ru#section", `https://${"a.".repeat(150)}ru`,
  ]) assert.equal(parsePublicAppOrigin(value), null, value);
});

test("integer settings fall back for non-finite values and stay within operating bounds", () => {
  for (const input of [undefined, "", "0", "Infinity", "-Infinity", "NaN", "invalid"]) {
    assert.equal(parseBoundedInteger(input, 5, 1, 20), 5);
  }
  assert.equal(parseBoundedInteger("2.9", 5, 1, 20), 2);
  assert.equal(parseBoundedInteger("-1", 5, 1, 20), 1);
  assert.equal(parseBoundedInteger("21", 5, 1, 20), 20);
});

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

test("decrypts v2 AAD-bound SMTP passwords only with matching host, port and username", () => {
  const key = randomBytes(32);
  const iv = randomBytes(12);
  const context = { host: "smtp.example.ru", port: 465, username: "mailer" };
  const cipher = createCipheriv("aes-256-gcm", key, iv, { authTagLength: 16 });
  cipher.setAAD(Buffer.from("smtp:smtp.example.ru:465:mailer", "utf8"));
  const encrypted = Buffer.concat([cipher.update("секрет-v2", "utf8"), cipher.final(), cipher.getAuthTag()]);
  const serialized = `v2:${iv.toString("base64")}:${encrypted.toString("base64")}`;

  assert.equal(decryptPassword(serialized, key.toString("base64"), context), "секрет-v2");
  assert.equal(decryptPassword(serialized, key.toString("base64"), { ...context, host: "SMTP.EXAMPLE.RU" }), "секрет-v2");
  assert.throws(() => decryptPassword(serialized, key.toString("base64")));
  assert.throws(() => decryptPassword(serialized, key.toString("base64"), { ...context, host: "evil.example.ru" }));
  assert.throws(() => decryptPassword(serialized, key.toString("base64"), { ...context, port: 587 }));
  assert.throws(() => decryptPassword(serialized, key.toString("base64"), { ...context, username: "other" }));
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
