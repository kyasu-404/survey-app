export const DEFAULT_STORAGE_CLEANUP_RETENTION_HOURS = 7 * 24;
export const DEFAULT_STORAGE_CLEANUP_INTERVAL_HOURS = 24;
export const STORAGE_CLEANUP_BATCH_LIMIT = 500;

const cleanupBuckets = [
  {
    bucket: "survey-files",
    listFunction: "list_orphan_survey_files",
    confirmFunction: "confirm_orphan_survey_files",
    resultKey: "removedFiles",
  },
  {
    bucket: "survey-assets",
    listFunction: "list_orphan_survey_assets",
    confirmFunction: "confirm_orphan_survey_assets",
    resultKey: "removedAssets",
  },
];

function getObjectNames(rows) {
  if (!Array.isArray(rows)) return [];
  return rows
    .map((row) => row?.name)
    .filter((name) => typeof name === "string" && name.length > 0);
}

function getStartedRun(rows) {
  const run = Array.isArray(rows) ? rows[0] : null;
  return run && typeof run.id === "string" ? run : null;
}

async function finishRun(rpc, runId, workerId, success, result, error = null) {
  const rows = await rpc("finish_storage_cleanup_run", {
    p_run_id: runId,
    p_worker_id: workerId,
    p_success: success,
    p_removed_files: result.removedFiles,
    p_removed_assets: result.removedAssets,
    p_error: error,
  });
  const run = getStartedRun(rows);
  if (!run) throw new Error("Storage cleanup run could not be finalized");
  return run;
}

export async function runScheduledStorageCleanup({
  rpc,
  removeObjects,
  workerId,
  retentionHours = DEFAULT_STORAGE_CLEANUP_RETENTION_HOURS,
  intervalHours = DEFAULT_STORAGE_CLEANUP_INTERVAL_HOURS,
  maxBatchesPerBucket = 20,
  now = () => Date.now(),
}) {
  const startedRows = await rpc("begin_storage_cleanup_run", {
    p_trigger_type: "scheduled",
    p_worker_id: workerId,
    p_retention_hours: retentionHours,
    p_requested_by: null,
    p_min_interval_hours: intervalHours,
  });
  const startedRun = getStartedRun(startedRows);
  if (!startedRun) return { skipped: true, run: null, removedFiles: 0, removedAssets: 0 };

  const result = { removedFiles: 0, removedAssets: 0 };
  const cutoff = new Date(now() - retentionHours * 60 * 60 * 1000).toISOString();

  try {
    for (const cleanupBucket of cleanupBuckets) {
      for (let batchIndex = 0; batchIndex < maxBatchesPerBucket; batchIndex += 1) {
        const candidates = getObjectNames(await rpc(cleanupBucket.listFunction, {
          cutoff,
          batch_limit: STORAGE_CLEANUP_BATCH_LIMIT,
        }));
        if (candidates.length === 0) break;

        const confirmed = getObjectNames(await rpc(cleanupBucket.confirmFunction, {
          cutoff,
          object_names: candidates,
        }));
        if (confirmed.length === 0) break;

        await removeObjects(cleanupBucket.bucket, confirmed);
        result[cleanupBucket.resultKey] += confirmed.length;

        if (candidates.length < STORAGE_CLEANUP_BATCH_LIMIT) break;
      }
    }

    const run = await finishRun(rpc, startedRun.id, workerId, true, result);
    return { skipped: false, run, ...result };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    try {
      await finishRun(rpc, startedRun.id, workerId, false, result, message);
    } catch (finishError) {
      console.error("storage cleanup result could not be recorded", {
        runId: startedRun.id,
        message: finishError instanceof Error ? finishError.message : String(finishError),
      });
    }
    throw error;
  }
}
