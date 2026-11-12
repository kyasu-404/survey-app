import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSecureContext, TLSSocket } from "node:tls";
import test from "node:test";
import nodemailer from "nodemailer";
import { createTransportOptions } from "../src/config.mjs";

test("self-signed SMTP requires an explicit exception for TLS and STARTTLS", { timeout: 20_000 }, async t => {
  const directory = mkdtempSync(join(tmpdir(), "survey-smtp-tls-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const key = join(directory, "key.pem"), cert = join(directory, "cert.pem");
  execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1",
    "-keyout", key, "-out", cert, "-subj", "/CN=localhost", "-addext", "subjectAltName=DNS:localhost"], { stdio: "ignore" });
  const secureContext = createSecureContext({ key: readFileSync(key), cert: readFileSync(cert) });

  for (const ssl_mode of ["tls", "starttls"]) {
    const sockets = new Set();
    let authentications = 0;
    const server = createServer(raw => {
      sockets.add(raw);
      raw.on("close", () => sockets.delete(raw));
      raw.on("error", () => {});
      function speak(socket, encrypted) {
        let buffer = "";
        socket.on("error", () => {});
        const onData = chunk => {
          buffer += chunk.toString();
          while (buffer.includes("\r\n")) {
            const end = buffer.indexOf("\r\n"), line = buffer.slice(0, end);
            buffer = buffer.slice(end + 2);
            if (line.startsWith("EHLO")) socket.write(encrypted ? "250-fixture\r\n250 AUTH PLAIN\r\n" : "250-fixture\r\n250 STARTTLS\r\n");
            else if (line === "STARTTLS") {
              socket.removeListener("data", onData);
              socket.write("220 Ready for TLS\r\n");
              speak(new TLSSocket(raw, { isServer: true, secureContext }), true);
            } else if (line.startsWith("AUTH")) { authentications++; socket.write("235 Authenticated\r\n"); }
            else if (line === "QUIT") socket.end("221 Bye\r\n");
          }
        };
        socket.on("data", onData);
      }
      const socket = ssl_mode === "tls" ? new TLSSocket(raw, { isServer: true, secureContext }) : raw;
      speak(socket, ssl_mode === "tls");
      socket.write("220 fixture ESMTP\r\n");
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    try {
      for (const allow_invalid_certificate of [false, true, false]) {
        const transport = nodemailer.createTransport(createTransportOptions({
          host: "127.0.0.1", port: server.address().port, ssl_mode, username: "test", allow_invalid_certificate,
        }, "local-test-password"));
        try {
          if (allow_invalid_certificate) assert.equal(await transport.verify(), true);
          else await assert.rejects(transport.verify(), /self[- ]signed certificate/i);
        } finally { transport.close(); }
      }
      assert.equal(authentications, 1, `${ssl_mode}: certificate failures must stop authentication`);
    } finally {
      for (const socket of sockets) socket.destroy();
      await new Promise(resolve => server.close(resolve));
    }
  }
});
