export function startStorageCleanup({ pool, store, intervalMs = 60000 }) {
  let active = null;
  let stopping = false;
  async function clean() {
    // Keep superseded files beyond the one-hour document-download capability TTL.
    const { rows } = await pool.query(`select c.storage_path from public.office_storage_cleanup c
      where c.created_at < now() - interval '2 hours'
      and not exists (select 1 from public.office_documents d where d.storage_path=c.storage_path)
      and not exists (select 1 from public.office_generation_jobs j where j.storage_path=c.storage_path and j.state in ('queued','running'))
      limit 100`);
    await pool.query("delete from public.office_generation_jobs where state in ('succeeded','failed') and finished_at<now()-interval '7 days'");
    for (const row of rows) {
      if (stopping) break;
      const { error } = await store.remove([row.storage_path]);
      if (!error) await pool.query('delete from public.office_storage_cleanup where storage_path=$1', [row.storage_path]);
    }
  }
  const timer = setInterval(() => {
    if (active) return;
    active = clean()
      .catch(() => console.error('Office storage cleanup failed'))
      .finally(() => { active = null; });
  }, intervalMs).unref();
  return async () => { stopping = true; clearInterval(timer); await active; };
}

export async function shutdownOffice({ server, pool, stopGenerationWorker, stopStorageCleanup }) {
  const closeServer = new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  server.closeIdleConnections();
  const drained = await Promise.allSettled([closeServer, stopGenerationWorker(), stopStorageCleanup()]);
  await pool.end();
  const failure = drained.find(result => result.status === 'rejected');
  if (failure) throw failure.reason;
}
