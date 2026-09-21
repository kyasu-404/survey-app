import { randomUUID } from 'node:crypto';
import { HttpError, requireValue } from './security.mjs';
import { runOfficeTask } from './office-tasks.mjs';

const LOCK = "hashtextextended('survey-office-generation-worker',0)";

export async function enqueueGeneration(pool, documentId, userId, ids, nameQuestionId) {
  const db = await pool.connect();
  try {
    await db.query('begin');
    await db.query("set local lock_timeout='10s'");
    await db.query("select pg_advisory_xact_lock(hashtextextended('survey-office-generation-queue',0))");
    const { rows: [budget] } = await db.query(`select count(*)::int as total,
      count(*) filter(where created_by=$1)::int as own, coalesce(sum(payload_bytes),0)::int as bytes
      from public.office_generation_jobs where state in ('queued','running')`, [userId]);
    requireValue(budget.total < 20 && budget.own < 2, 'Очередь занята. Дождитесь завершения текущих заданий.', 429);
    const { rows: [doc] } = await db.query('select * from public.office_documents where id=$1 for share', [documentId]);
    requireValue(doc && !doc.last_save_error, 'Макет удалён или не сохранён. Откройте его снова.', 409);
    // Form, answers and directory share the snapshot of this single statement.
    const { rows: [snapshot] } = await db.query(`select to_jsonb(f) as form,
      (select coalesce(jsonb_agg(r order by r.created_at,r.id),'[]') from
        (select id,data,created_at,updated_at from public.responses where form_id=f.id
         and ($2::uuid[] is null or id=any($2)) order by created_at,id limit 501) r) as responses,
      (select coalesce(jsonb_agg(o),'[]') from (select id,alias,number from public.education_organizations) o) as organizations
      from public.forms f where f.id=$1`, [doc.form_id, ids ?? null]);
    requireValue(snapshot?.responses.length > 0 && snapshot.responses.length <= 500, 'Для одной выгрузки выберите от 1 до 500 ответов');
    requireValue(!ids || snapshot.responses.length === ids.length, 'Некоторые выбранные ответы удалены или относятся к другой форме');
    const payload = JSON.stringify({ ...snapshot, nameQuestionId, name: doc.name, format: doc.file_type });
    const bytes = Buffer.byteLength(payload);
    requireValue(bytes <= 8 * 1024 * 1024 && budget.bytes + bytes <= 64 * 1024 * 1024,
      'Слишком много данных для выгрузки. Уменьшите выборку или дождитесь завершения других заданий.', 413);
    const { rows: [job] } = await db.query(`insert into public.office_generation_jobs
      (form_id,template_id,created_by,name,file_type,storage_path,payload,payload_bytes)
      values($1,$2,$3,$4,$5,$6,$7,$8) returning id,form_id,name,state,created_at`,
    [doc.form_id, doc.id, userId, doc.name, doc.file_type, doc.storage_path, payload, bytes]);
    await db.query('commit');
    return job;
  } catch (error) { await db.query('rollback'); throw error; }
  finally { db.release(); }
}

/** A PostgreSQL session lock gives one worker across replicas. Running jobs are
 * reclaimed after a crash; attempt tokens fence a worker whose DB session died. */
export async function processGenerationJob({ pool, store, runTask = runOfficeTask }) {
  const db = await pool.connect();
  let locked = false, job, path, uploaded = false, connectionError = null;
  const onError = error => { connectionError = error; };
  db.on?.('error', onError);
  try {
    const { rows: [lock] } = await db.query(`select pg_try_advisory_lock(${LOCK}) as acquired`);
    locked = lock.acquired;
    if (!locked) return false;
    await db.query(`update public.office_generation_jobs set state='failed',payload=null,payload_bytes=0,
      error='Обработка прервалась несколько раз. Повторите выгрузку.',finished_at=now()
      where state='running' and attempts>=3`);
    const { rows } = await db.query(`update public.office_generation_jobs set state='running',
      attempt_token=$1,attempts=attempts+1,started_at=now() where id=(
        select id from public.office_generation_jobs where state in ('queued','running')
        and attempts<3 and available_at<=now() order by created_at,id limit 1) returning *`, [randomUUID()]);
    job = rows[0];
    if (!job) return false;
    const { rows: [profile] } = await db.query('select is_disabled from public.profiles where id=$1', [job.created_by]);
    requireValue(profile && !profile.is_disabled, 'Учётная запись автора задания отключена.', 403);
    const { data, error } = await store.download(job.storage_path);
    requireValue(!error && data, 'Макет временно недоступен. Повторите выгрузку.', 502);
    const output = await runTask({ ...job.payload, task: 'generate', bytes: Buffer.from(await data.arrayBuffer()) });
    if (connectionError) throw connectionError;
    path = `forms/${job.form_id}/results/${job.attempt_token}.zip`;
    const { error: uploadError } = await store.upload(path, output.bytes, { contentType: 'application/zip', upsert: false });
    requireValue(!uploadError, 'Не удалось сохранить архив. Повторите выгрузку.', 502);
    uploaded = true;
    await db.query('begin');
    const { rows: owned } = await db.query(`select id,template_id from public.office_generation_jobs
      where id=$1 and attempt_token=$2 and state='running' for update`, [job.id, job.attempt_token]);
    requireValue(owned.length, 'Задание уже обрабатывает другой исполнитель.', 409);
    await db.query(`insert into public.office_generation_results
      (id,form_id,template_id,name,file_type,storage_path,files,size_bytes,created_by)
      values($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [job.id, job.form_id, owned[0].template_id,
      job.name.replace(/\.(docx|xlsx)$/i, '') + '.zip', job.file_type, path, JSON.stringify(output.files), output.bytes.length, job.created_by]);
    await db.query(`update public.office_generation_jobs set state='succeeded',finished_at=now(),
      payload=null,payload_bytes=0,error=null where id=$1 and attempt_token=$2`, [job.id, job.attempt_token]);
    await db.query('commit');
    uploaded = false;
    return true;
  } catch (error) {
    await db.query('rollback').catch(() => {});
    // If COMMIT acknowledgement was lost, never delete a potentially committed
    // result. The orphan cleanup will remove abandoned immutable attempt files.
    if (uploaded && !connectionError) {
      const { rows } = await db.query('select id from public.office_generation_results where storage_path=$1', [path]);
      if (!rows.length) await store.remove([path]);
    }
    if (job && !connectionError) {
      if ([429,502,504].includes(error.status) && job.attempts<3) {
        await db.query(`update public.office_generation_jobs set state='queued',available_at=now()+interval '15 seconds'
          where id=$1 and attempt_token=$2 and state='running'`,[job.id,job.attempt_token]);
      } else await db.query(`update public.office_generation_jobs
        set state='failed',payload=null,payload_bytes=0,finished_at=now(),error=$3
        where id=$1 and attempt_token=$2 and state='running'`, [job.id, job.attempt_token,
        error instanceof HttpError ? error.message : 'Не удалось обработать макет. Повторите выгрузку.']);
    }
    if (!job || connectionError) throw error;
    return true;
  } finally {
    if (locked) await db.query(`select pg_advisory_unlock(${LOCK})`).catch(() => {});
    db.removeListener?.('error', onError);
    db.release(connectionError || undefined);
  }
}

export function startGenerationWorker(dependencies) {
  let active = null;
  const tick = () => {
    if (active) return;
    active = processGenerationJob(dependencies).catch(() => console.error('Office generation worker failed')).finally(() => { active = null; });
  };
  const timer = setInterval(tick, 1500).unref();
  tick();
  return async () => { clearInterval(timer); await active; };
}
