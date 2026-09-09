import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import nodemailer from "nodemailer";
import { createTransportOptions } from "../src/config.mjs";

function createOfflineTransport() {
  return nodemailer.createTransport({
    ...createTransportOptions({ host: "smtp.example.test", port: 465, ssl_mode: "tls", username: "test" }, "test"),
    streamTransport: true,
    buffer: true,
  });
}

const message = {
  from: { name: "Генератор форм", address: "forms@example.test" },
  to: { name: "ГБОУ № 123", address: "office@пример.рф" },
  replyTo: "support@example.test",
  subject: "Напоминание: заполните форму «Отчёт»",
  text: "Срок сдачи: 10 сентября 2026 года, 18:00 (МСК).",
  disableFileAccess: true,
  disableUrlAccess: true,
};

test("builds a Russian reminder and an IDN envelope without delivering email", async (t) => {
  const transport = createOfflineTransport();
  t.after(() => transport.close());
  const result = await transport.sendMail({ ...message, textEncoding: "base64" });
  assert.deepEqual(result.envelope, {
    from: "forms@example.test",
    to: ["office@xn--e1afmkfd.xn--p1ai"],
  });
  const mime = result.message.toString();
  assert.match(mime, /Reply-To: support@example\.test/);
  assert.match(mime, /Content-Type: text\/plain; charset=utf-8/);
  assert.match(mime, /Content-Transfer-Encoding: base64/);
  assert.equal(Buffer.from(mime.split("\r\n\r\n").slice(1).join("\r\n\r\n"), "base64").toString(), message.text);
});

// Exercise the legacy plugin API behind GHSA-8m3c-c648-2xjj. The worker
// currently has no plugins; its file/URL policy must still survive upgrades.
function resolveTextInPlugin(transport) {
  transport.use("compile", (mail, done) => {
    mail.resolveContent(mail.data, "text", (error, content) => {
      if (error) return done(error);
      mail.data.text = content;
      done();
    });
  });
}

test("legacy content resolution respects disabled file access", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "survey-mail-policy-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const fixture = join(directory, "fixture.txt");
  await writeFile(fixture, "harmless test content");
  const transport = createOfflineTransport();
  t.after(() => transport.close());
  resolveTextInPlugin(transport);

  await assert.rejects(transport.sendMail({ ...message, text: { path: fixture } }), { code: "EFILEACCESS" });
  const control = await transport.sendMail({ ...message, text: "Inline content remains allowed" });
  assert.match(control.message.toString(), /Inline content remains allowed/);
});

test("legacy content resolution blocks URL access before making a request", async (t) => {
  let requests = 0;
  const server = createServer((_request, response) => {
    requests += 1;
    response.end("harmless test content");
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const transport = createOfflineTransport();
  t.after(() => transport.close());
  resolveTextInPlugin(transport);

  await assert.rejects(transport.sendMail({
    ...message,
    text: { href: `http://127.0.0.1:${server.address().port}/fixture` },
  }), { code: "EURLACCESS" });
  assert.equal(requests, 0);
});
