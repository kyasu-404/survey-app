import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

async function listen(server) {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return server.address().port;
}

async function startWorker(t, publicAppUrl, handleRequest) {
  const api = createServer(handleRequest);
  const apiPort = await listen(api);
  t.after(() => {
    api.close();
    api.closeAllConnections();
  });

  const portProbe = createServer();
  const port = await listen(portProbe);
  await new Promise((resolve) => portProbe.close(resolve));
  const worker = spawn(process.execPath, [fileURLToPath(new URL("../src/index.mjs", import.meta.url))], {
    stdio: "ignore",
    env: {
      SUPABASE_URL: `http://127.0.0.1:${apiPort}`,
      SUPABASE_SERVICE_ROLE_KEY: "test",
      MAIL_SETTINGS_ENCRYPTION_KEY: Buffer.alloc(32).toString("base64"),
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
    async healthAfterPoll() {
      for (let i = 0; i < 100; i++) {
        const response = await fetch(`http://127.0.0.1:${port}/health`).catch(() => null);
        const state = await response?.json();
        if (state?.lastSuccessfulPollAt) return { status: response.status, state };
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
