import assert from "node:assert/strict";
import test from "node:test";
import { runScheduledStorageCleanup } from "../src/storageCleanup.mjs";

test("scheduled cleanup skips when a recent or concurrent run owns the lease", async () => {
  const rpcCalls = [];
  const removeCalls = [];

  const result = await runScheduledStorageCleanup({
    rpc: async (name, body) => {
      rpcCalls.push({ name, body });
      return [];
    },
    removeObjects: async (...args) => removeCalls.push(args),
    workerId: "worker:1",
  });

  assert.equal(result.skipped, true);
  assert.equal(rpcCalls.length, 1);
  assert.equal(rpcCalls[0].name, "begin_storage_cleanup_run");
  assert.equal(rpcCalls[0].body.p_retention_hours, 168);
  assert.equal(rpcCalls[0].body.p_min_interval_hours, 24);
  assert.deepEqual(removeCalls, []);
});

test("scheduled cleanup deletes only candidates confirmed immediately before removal", async () => {
  const rpcCalls = [];
  const removeCalls = [];
  const responses = new Map([
    ["begin_storage_cleanup_run", [{ id: "run-1" }]],
    ["list_orphan_survey_files", [{ name: "public/form/a.txt" }, { name: "public/form/in-use.txt" }]],
    ["confirm_orphan_survey_files", [{ name: "public/form/a.txt" }]],
    ["list_orphan_survey_assets", [{ name: "forms/form/owner/asset.webp" }]],
    ["confirm_orphan_survey_assets", [{ name: "forms/form/owner/asset.webp" }]],
    ["finish_storage_cleanup_run", [{ id: "run-1", status: "succeeded" }]],
  ]);

  const result = await runScheduledStorageCleanup({
    rpc: async (name, body) => {
      rpcCalls.push({ name, body });
      return responses.get(name) ?? [];
    },
    removeObjects: async (bucket, names) => removeCalls.push({ bucket, names }),
    workerId: "worker:1",
    now: () => Date.parse("2026-08-10T12:00:00.000Z"),
  });

  assert.equal(result.skipped, false);
  assert.equal(result.removedFiles, 1);
  assert.equal(result.removedAssets, 1);
  assert.deepEqual(removeCalls, [
    { bucket: "survey-files", names: ["public/form/a.txt"] },
    { bucket: "survey-assets", names: ["forms/form/owner/asset.webp"] },
  ]);
  assert.equal(
    rpcCalls.find((call) => call.name === "confirm_orphan_survey_files")?.body.cutoff,
    "2026-08-03T12:00:00.000Z",
  );
  assert.deepEqual(
    rpcCalls.find((call) => call.name === "finish_storage_cleanup_run")?.body,
    {
      p_run_id: "run-1",
      p_worker_id: "worker:1",
      p_success: true,
      p_removed_files: 1,
      p_removed_assets: 1,
      p_error: null,
    },
  );
});

test("scheduled cleanup records a failed run without deleting the next bucket", async () => {
  const rpcCalls = [];
  const responses = new Map([
    ["begin_storage_cleanup_run", [{ id: "run-2" }]],
    ["list_orphan_survey_files", [{ name: "public/form/a.txt" }]],
    ["confirm_orphan_survey_files", [{ name: "public/form/a.txt" }]],
    ["finish_storage_cleanup_run", [{ id: "run-2", status: "failed" }]],
  ]);

  await assert.rejects(() => runScheduledStorageCleanup({
    rpc: async (name, body) => {
      rpcCalls.push({ name, body });
      return responses.get(name) ?? [];
    },
    removeObjects: async () => {
      throw new Error("Storage is unavailable");
    },
    workerId: "worker:2",
  }), /Storage is unavailable/);

  assert.equal(rpcCalls.some((call) => call.name === "list_orphan_survey_assets"), false);
  assert.deepEqual(
    rpcCalls.findLast((call) => call.name === "finish_storage_cleanup_run")?.body,
    {
      p_run_id: "run-2",
      p_worker_id: "worker:2",
      p_success: false,
      p_removed_files: 0,
      p_removed_assets: 0,
      p_error: "Storage is unavailable",
    },
  );
});
