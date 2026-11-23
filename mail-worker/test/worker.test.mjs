import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createCipheriv } from "node:crypto";
import { once } from "node:events";
import { createServer } from "node:http";
import { createServer as createTcpServer } from "node:net";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

async function listen(server) {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return server.address().port;
}

const encryptionKey = Buffer.alloc(32);

async function startWorker(t, publicAppUrl, handleRequest, preload = []) {
  const api = createServer(handleRequest);
  const apiPort = await listen(api);
  t.after(() => {
    api.close();
    api.closeAllConnections();
  });

  const portProbe = createServer();
  const port = await listen(portProbe);
  await new Promise((resolve) => portProbe.close(resolve));
  const worker = spawn(process.execPath, [...preload, fileURLToPath(new URL("../src/index.mjs", import.meta.url))], {
    stdio: "ignore",
    env: {
      SUPABASE_URL: `http://127.0.0.1:${apiPort}`,
      SUPABASE_SERVICE_ROLE_KEY: "test",
      MAIL_SETTINGS_ENCRYPTION_KEY: encryptionKey.toString("base64"),
      MAIL_WORKER_HEALTH_PORT: String(port),
      ...(publicAppUrl === undefined ? {} : { PUBLIC_APP_URL: publicAppUrl }),
    },
  });
  const exit = once(worker, "exit");
  t.after(async () => {
    if (worker.exitCode === null && worker.signalCode === null) worker.kill("SIGKILL");
    await exit;
  });
  return {
    worker, exit,
    async healthAfterPoll(ready = state => state.lastSuccessfulPollAt) {
      for (let i = 0; i < 100; i++) {
        const response = await fetch(`http://127.0.0.1:${port}/health`).catch(() => null);
        const state = await response?.json();
        if (state && ready(state)) return { status: response.status, state };
        await delay(30);
      }
      throw new Error("Worker did not poll the mail queue");
    },
  };
}

for (const publicAppUrl of [undefined, "http://[::1]:5173"]) {
  test(`disables automation RPCs while delivery polls continue for PUBLIC_APP_URL=${publicAppUrl}`, async (t) => {
    const requests = [];
    const worker = await startWorker(t, publicAppUrl, (req, res) => {
      requests.push(req.url);
      res.end("[]");
    });
    const { status, state } = await worker.healthAfterPoll();
    assert.equal(status, 503);
    assert.match(state.lastAutomationError, /PUBLIC_APP_URL/);
    assert.ok(requests.some(path => path.startsWith("/rest/v1/mail_settings?")));
    assert.ok(!requests.includes("/rest/v1/rpc/process_automations"));
  });
}

test("runs process_automations with the public origin and reports healthy", async (t) => {
  const automationCalls = [];
  const worker = await startWorker(t, "https://forms.example.test:8443/", async (req, res) => {
    if (req.url.endsWith("/process_automations")) {
      let body = "";
      for await (const chunk of req) body += chunk;
      automationCalls.push({ method: req.method, body: JSON.parse(body) });
    }
    res.end("[]");
  });
  const { status, state } = await worker.healthAfterPoll(current => current.lastSuccessfulPollAt && current.lastAutomationPollAt);
  assert.equal(status, 200);
  assert.equal(state.lastAutomationError, null);
  assert.deepEqual(automationCalls, [{
    method: "POST",
    body: { p_app_origin: "https://forms.example.test:8443", p_limit: 50 },
  }]);
});

async function startSmtpSink(t) {
  let messages = 0;
  const connections = new Set();
  const server = createTcpServer(socket => {
    connections.add(socket);
    socket.on("close", () => connections.delete(socket));
    socket.on("error", () => {});
    socket.write("220 local SMTP test fixture\r\n");
    let buffer = "";
    let readingMessage = false;
    socket.on("data", chunk => {
      buffer += chunk.toString();
      for (let end = buffer.indexOf("\r\n"); end !== -1; end = buffer.indexOf("\r\n")) {
        const command = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        if (readingMessage) {
          if (command === ".") {
            messages++;
            readingMessage = false;
            socket.write("250 accepted\r\n");
          }
        } else if (command.startsWith("EHLO")) socket.write("250-fixture\r\n250 AUTH PLAIN\r\n");
        else if (command.startsWith("AUTH")) socket.write("235 authenticated\r\n");
        else if (command === "DATA") {
          readingMessage = true;
          socket.write("354 send message\r\n");
        } else if (command === "QUIT") socket.end("221 bye\r\n");
        else socket.write("250 OK\r\n");
      }
    });
  });
  const port = await listen(server);
  t.after(() => {
    for (const socket of connections) socket.destroy();
    return new Promise(resolve => server.close(resolve));
  });
  const iv = Buffer.alloc(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey, iv);
  const encryptedPassword = Buffer.concat([cipher.update("test"), cipher.final(), cipher.getAuthTag()]);
  const settings = {
    enabled: true, host: "127.0.0.1", port, ssl_mode: "none", username: "test",
    password_encrypted: ["v1", iv.toString("base64"), encryptedPassword.toString("base64")].join(":"),
    from_email: "sender@example.test", from_name: "Sender",
  };
  return { settings, get messages() { return messages; } };
}

for (const finalAckSucceeds of [true, false]) {
  test(`SIGTERM retries pending SMTP acknowledgements and exits ${finalAckSucceeds ? "successfully after confirmation" : "with an error if unconfirmed"}`, { timeout: 8_000 }, async (t) => {
    const smtp = await startSmtpSink(t);
    let claims = 0;
    const acknowledgements = [];
    const { worker, exit, healthAfterPoll } = await startWorker(t, "https://forms.example.test", async (req, res) => {
      if (req.url.startsWith("/rest/v1/mail_settings?")) {
        res.end(JSON.stringify([smtp.settings]));
      } else if (req.url.endsWith("/claim_mail_jobs")) {
        claims++;
        res.end(JSON.stringify([{
          id: "mail-job", recipient_email: "recipient@example.test", subject: "Test message", body_text: "Local fixture only",
        }]));
      } else if (req.url.endsWith("/finish_mail_job")) {
        let body = "";
        for await (const chunk of req) body += chunk;
        acknowledgements.push(JSON.parse(body));
        if (acknowledgements.length === 1 || !finalAckSucceeds) {
          res.writeHead(503).end("{}");
        } else {
          res.end('"sent"');
        }
      } else {
        res.end("[]");
      }
    });

    await healthAfterPoll(state => state.pendingAcknowledgements === 1 && !state.busy);
    worker.kill("SIGTERM");
    assert.deepEqual(await exit, [finalAckSucceeds ? 0 : 1, null]);
    assert.equal(claims, 1);
    assert.equal(smtp.messages, 1);
    if (finalAckSucceeds) {
      assert.deepEqual(acknowledgements.map(({ p_job_id, p_success }) => [p_job_id, p_success]), [
        ["mail-job", true], ["mail-job", true],
      ]);
    } else {
      assert.ok(acknowledgements.length >= 2);
      assert.ok(acknowledgements.every(({ p_job_id, p_success }) => p_job_id === "mail-job" && p_success === true));
    }
  });
}

test("SIGTERM drains expired uploads before exiting with an idle health connection", { timeout: 8_000 }, async (t) => {
  let releaseListing;
  let completeListing;
  const listingStarted = new Promise(resolve => { releaseListing = resolve; });
  let expiredReservationsRemoved = false;
  const { worker, exit, healthAfterPoll } = await startWorker(t, "https://forms.example.test", (req, res) => {
    if (req.url.endsWith("/list_expired_survey_uploads")) {
      completeListing = () => res.end("[]");
      releaseListing();
    } else {
      if (req.method === "DELETE" && req.url.startsWith("/rest/v1/survey_upload_reservations?")) {
        expiredReservationsRemoved = true;
      }
      res.end("[]");
    }
  });
  await listingStarted;
  await healthAfterPoll();
  worker.kill("SIGTERM");
  await delay(100);
  completeListing();
  assert.deepEqual(await exit, [0, null]);
  assert.equal(expiredReservationsRemoved, true);
});

test("SIGTERM forces an error exit when cleanup outlives the shutdown grace period", { timeout: 8_000 }, async (t) => {
  const clock = `import { mock } from "node:test";
    process.on("SIGTERM", () => {
      mock.timers.enable({ apis: ["setTimeout"] });
      setImmediate(() => mock.timers.tick(180_000));
    });`;
  let onListingStarted;
  const listingStarted = new Promise(resolve => { onListingStarted = resolve; });
  const { worker, exit, healthAfterPoll } = await startWorker(t, "https://forms.example.test", (req, res) => {
    if (req.url.endsWith("/list_expired_survey_uploads")) {
      // Leave this request pending beyond the worker's shutdown grace period.
      onListingStarted();
    } else {
      res.end("[]");
    }
  }, ["--import", `data:text/javascript,${encodeURIComponent(clock)}`]);
  await listingStarted;
  await healthAfterPoll();
  worker.kill("SIGTERM");
  assert.deepEqual(await exit, [1, null]);
});
