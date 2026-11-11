import assert from "node:assert/strict";
import test from "node:test";
import { createMailPoller, parseMailJobStatus } from "../src/delivery.mjs";
import { isWorkerHealthy } from "../src/health.mjs";

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function createFixture({ ids = ["first"], failAck = () => null, send = async () => {} } = {}) {
  let nowMs = Date.now();
  let claims = 0;
  let settingsLoads = 0;
  let settings = { enabled: true, from_name: "Forms", from_email: "forms@example.test", reply_to: "" };
  const state = { busy: false, lastError: null, lastSuccessfulPollAt: null, lastSuccessAt: null };
  const queue = new Map(ids.map((id) => [id, {
    id,
    batch_id: "batch",
    recipient_name: id,
    recipient_email: `${id}@example.test`,
    subject: id,
    body_text: "Reminder",
    status: "queued",
    locked_at: null,
    locked_by: null,
  }]));
  const delivered = [];
  const acknowledgements = [];
  const cancellations = [];
  const errors = [];
  const logger = { error(message, context) { errors.push({ message, context }); }, warn(message, context) { cancellations.push({ message, context }); } };
  const smtpTransports = {
    close() {},
    get() {
      return { async sendMail(message) { await send(message); delivered.push(message.subject); } };
    },
  };
  const poll = createMailPoller({
    state,
    smtpTransports,
    logger,
    now: () => new Date(nowMs),
    async loadSettings() { settingsLoads += 1; return settings; },
    async claimJobs() {
      claims += 1;
      const rows = [...queue.values()].filter((row) => row.status === "queued"
        || (row.status === "processing" && row.locked_at < nowMs - 600_000));
      for (const row of rows) {
        row.status = "processing";
        row.locked_at = nowMs;
        row.locked_by = "this-worker";
      }
      return rows.map((row) => ({ ...row }));
    },
    async finishJob(id, success, error) {
      acknowledgements.push({ id, success, error });
      const attempt = acknowledgements.filter((ack) => ack.id === id && ack.success === success).length;
      const failure = failAck({ id, success, attempt });
      if (failure === "before") throw new Error("Supabase unavailable before commit");
      const row = queue.get(id);
      let result = null;
      if (row?.status === "processing" && row.locked_by === "this-worker") {
        result = row.status = success ? "sent" : "queued";
        row.locked_at = null;
        row.locked_by = null;
      }
      if (failure === "after") throw new Error("Supabase response lost after commit");
      return result;
    },
    async loadJobStatus(id) { return queue.has(id) ? { ...queue.get(id) } : null; },
  });
  return {
    poll, state, queue, delivered, acknowledgements, cancellations, errors, smtpTransports,
    get claims() { return claims; },
    get settingsLoads() { return settingsLoads; },
    setSettings(next) { settings = next; },
    advance(ms) { nowMs += ms; },
  };
}

test("retries an accepted message's failed ACK without putting it back in the SMTP queue", async () => {
  const fixture = createFixture({ failAck: ({ success, attempt }) => success && attempt === 1 ? "before" : null });
  await fixture.poll();

  assert.deepEqual(fixture.delivered, ["first"]);
  assert.equal(fixture.queue.get("first").status, "processing");
  assert.ok(fixture.state.lastError);
  assert.equal(fixture.state.pendingAcknowledgements, 1);
  assert.equal(isWorkerHealthy(fixture.state, Date.now(), 3_000), false);

  await fixture.poll();
  assert.equal(fixture.queue.get("first").status, "sent");
  assert.deepEqual(fixture.delivered, ["first"]);
  assert.deepEqual(fixture.acknowledgements.map(({ success }) => success), [true, true]);
  assert.equal(fixture.state.lastError, null);
  assert.equal(fixture.state.pendingAcknowledgements, 0);
  assert.ok(fixture.state.lastSuccessAt);
  assert.equal(isWorkerHealthy(fixture.state, Date.now(), 3_000), true);
});

test("confirms an already committed ACK when retrying returns the SQL no-op result", async () => {
  const fixture = createFixture({ failAck: ({ success, attempt }) => success && attempt === 1 ? "after" : null });
  await fixture.poll();
  assert.equal(fixture.queue.get("first").status, "sent");
  assert.ok(fixture.state.lastError);
  assert.equal(fixture.state.pendingAcknowledgements, 1);

  await fixture.poll();
  assert.deepEqual(fixture.delivered, ["first"]);
  assert.deepEqual(fixture.acknowledgements.map(({ success }) => success), [true, true]);
  assert.equal(fixture.state.pendingAcknowledgements, 0);
  assert.equal(fixture.state.lastError, null);
});

test("keeps unresolved ACKs visible and blocks new claims after the lease expires", async () => {
  const fixture = createFixture({ failAck: ({ success }) => success ? "before" : null });
  await fixture.poll();
  fixture.advance(660_000);
  fixture.setSettings({ enabled: false });
  await fixture.poll();
  await fixture.poll();

  assert.equal(fixture.claims, 1);
  assert.equal(fixture.settingsLoads, 1);
  assert.deepEqual(fixture.delivered, ["first"]);
  assert.equal(fixture.queue.get("first").status, "processing");
  assert.equal(fixture.state.pendingAcknowledgements, 1);
  assert.ok(fixture.state.lastError);
  assert.equal(fixture.state.busy, false);
});

test("does not clear an accepted ACK when its lease moved to another worker", async () => {
  const fixture = createFixture({ failAck: ({ success, attempt }) => success && attempt === 1 ? "before" : null });
  await fixture.poll();
  fixture.queue.get("first").locked_by = "another-worker";
  await fixture.poll();

  assert.deepEqual(fixture.delivered, ["first"]);
  assert.equal(fixture.claims, 1);
  assert.equal(fixture.state.pendingAcknowledgements, 1);
  assert.ok(fixture.state.lastError);
  assert.equal(fixture.queue.get("first").locked_by, "another-worker");
});

test("cancels an ACK for a job deleted during SMTP delivery and continues unrelated jobs", async () => {
  const fixture = createFixture({
    async send(message) {
      if (message.subject === "first") fixture.queue.delete("first");
    },
  });
  const unrelated = { ...fixture.queue.get("first"), id: "unrelated", subject: "unrelated" };
  await fixture.poll();

  assert.deepEqual(fixture.delivered, ["first"]);
  assert.equal(fixture.queue.has("first"), false);
  assert.equal(fixture.state.pendingAcknowledgements, 0);
  assert.equal(fixture.state.lastSuccessAt, null);
  assert.equal(fixture.state.lastError, null);
  assert.equal(fixture.cancellations.length, 1);
  assert.equal(fixture.cancellations[0].context.jobId, "first");

  fixture.queue.set("unrelated", unrelated);
  await fixture.poll();
  assert.equal(fixture.claims, 2);
  assert.deepEqual(fixture.delivered, ["first", "unrelated"]);
  assert.deepEqual(fixture.acknowledgements.map(({ success }) => success), [true, true]);
  assert.equal(fixture.queue.get("unrelated").status, "sent");
  assert.equal(fixture.state.pendingAcknowledgements, 0);
  assert.ok(fixture.state.lastSuccessAt);
});

test("reports a terminal failed ACK conflict without freezing unrelated deliveries", async () => {
  const fixture = createFixture({ failAck: ({ id, success, attempt }) => id === "first" && success && attempt === 1 ? "before" : null });
  const unrelated = { ...fixture.queue.get("first"), id: "unrelated", subject: "unrelated" };
  await fixture.poll();
  fixture.queue.get("first").status = "failed";
  fixture.queue.get("first").locked_by = null;
  await fixture.poll();

  assert.deepEqual(fixture.delivered, ["first"]);
  assert.equal(fixture.queue.get("first").status, "failed");
  assert.equal(fixture.state.pendingAcknowledgements, 0);
  assert.equal(fixture.state.lastSuccessAt, null);
  assert.equal(fixture.state.lastError, null);
  assert.equal(fixture.state.lastAcknowledgementConflict?.jobId, "first");
  assert.equal(fixture.state.lastAcknowledgementConflict?.status, "failed");
  assert.ok(Number.isFinite(Date.parse(fixture.state.lastAcknowledgementConflict?.at)));
  assert.equal(fixture.errors.some(({ context }) => context.jobId === "first" && context.status === "failed"), true);

  fixture.queue.set("unrelated", unrelated);
  await fixture.poll();
  assert.equal(fixture.claims, 3);
  assert.deepEqual(fixture.delivered, ["first", "unrelated"]);
  assert.deepEqual(fixture.acknowledgements.map(({ success }) => success), [true, true, true]);
  assert.equal(fixture.queue.get("unrelated").status, "sent");
  assert.equal(fixture.state.pendingAcknowledgements, 0);
});

test("confirms job absence only from a genuine empty status response array", () => {
  assert.equal(parseMailJobStatus([]), null);
  for (const status of ["queued", "processing", "sent", "failed"]) {
    assert.deepEqual(parseMailJobStatus([{ status }]), { status });
  }
  for (const malformed of [null, {}, { status: "sent" }, [null], [{}], [{ status: "unknown" }], [{ status: "sent" }, { status: "failed" }]]) {
    assert.throws(() => parseMailJobStatus(malformed), /status response/i);
  }
});

test("waits for sibling deliveries and never requeues accepted mail after another job's ACK fails", async () => {
  const accepted = deferred();
  const failedAck = deferred();
  const fixture = createFixture({
    ids: ["accepted", "rejected"],
    async send(message) {
      if (message.subject === "accepted") return accepted.promise;
      throw Object.assign(new Error("SMTP rejected recipient"), { responseCode: 550 });
    },
    failAck({ id, attempt }) {
      if (id === "rejected" && attempt === 1) {
        failedAck.resolve();
        return "before";
      }
      return null;
    },
  });
  const active = fixture.poll();
  await failedAck.promise;
  await new Promise(setImmediate);
  try {
    assert.equal(fixture.state.busy, true);
    assert.ok(fixture.state.lastError);
    assert.equal(isWorkerHealthy({ ...fixture.state, lastSuccessfulPollAt: new Date().toISOString() }, Date.now(), 3_000), false);
  } finally {
    accepted.resolve();
    await active;
  }

  assert.equal(fixture.queue.get("accepted").status, "sent");
  assert.equal(fixture.queue.get("rejected").status, "processing");
  assert.deepEqual(fixture.acknowledgements.filter(({ id }) => id === "accepted").map(({ success }) => success), [true]);
  assert.equal(fixture.state.pendingAcknowledgements, 1);
  await fixture.poll();
  assert.deepEqual(fixture.delivered, ["accepted"]);
  assert.equal(fixture.state.pendingAcknowledgements, 0);
});

test("records a genuine SMTP rejection as failure", async () => {
  const fixture = createFixture({ send: async () => { throw Object.assign(new Error("Authentication denied"), { code: "EAUTH" }); } });
  await fixture.poll();
  assert.deepEqual(fixture.delivered, []);
  assert.equal(fixture.queue.get("first").status, "queued");
  assert.deepEqual(fixture.acknowledgements, [{ id: "first", success: false, error: "SMTP-сервер отклонил имя пользователя или пароль" }]);
  assert.equal(fixture.state.lastError, null);
});

test("requeues only unsent jobs when creating the SMTP transport fails", async () => {
  const fixture = createFixture({ ids: ["first", "second"] });
  fixture.smtpTransports.get = () => { throw new Error("Invalid SMTP settings"); };
  await fixture.poll();
  assert.deepEqual(fixture.delivered, []);
  assert.deepEqual([...fixture.queue.values()].map(({ status }) => status), ["queued", "queued"]);
  assert.deepEqual(fixture.acknowledgements.map(({ success }) => success), [false, false]);
  assert.ok(fixture.state.lastError);
});
