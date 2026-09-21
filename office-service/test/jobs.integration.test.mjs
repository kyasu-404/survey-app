import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { HttpError } from '../src/security.mjs';
import { enqueueGeneration, processGenerationJob } from '../src/generation-jobs.mjs';
const url=process.env.OFFICE_TEST_DATABASE_URL;
test('durable Office jobs: snapshot, bounded queue, restart recovery, fencing and authorization', {skip:!url}, async t=>{
 assert.equal(new URL(url).pathname,'/office_integration_test','Use an isolated test database');
 const pool=new pg.Pool({connectionString:url,max:5});
 const owner=randomUUID(),form=randomUUID(),doc=randomUUID(),response=randomUUID();
 t.after(async()=>{try{await pool.query('delete from public.forms where id=$1',[form]);await pool.query('delete from auth.users where id=$1',[owner]);}finally{await pool.end();}});
 await pool.query("insert into auth.users(id,email,raw_user_meta_data) values($1,'jobs@example.invalid','{}')",[owner]);
 await pool.query("insert into public.forms(id,title,author_id,is_public,form_type,form_reason,schema) values($1,'Job review',$2,true,'anketa','plan',$3)",[form,owner,JSON.stringify({pages:[{elements:[{type:"text",name:"answer"}]}]})]);
 await pool.query("insert into public.responses(id,form_id,data) values($1,$2,'{\"answer\":\"snapshot\"}')",[response,form]);
 await pool.query("insert into public.office_documents(id,form_id,name,file_type,storage_path,size_bytes,created_by,updated_by) values($1,$2,'Test.docx','docx','forms/test/source.docx',10,$3,$3)",[doc,form,owner]);
 const first=await enqueueGeneration(pool,doc,owner,[response]);
 const second=await enqueueGeneration(pool,doc,owner,[response]);
 assert.equal(first.state,'queued');
 await assert.rejects(enqueueGeneration(pool,doc,owner,[response]),e=>e.status===429);
 await pool.query("update public.responses set data='{\"answer\":\"changed later\"}' where id=$1",[response]);
 // Pretend the service died after claiming its first job; no worker lock survives.
 await pool.query("update public.office_generation_jobs set state='running',attempts=1,attempt_token=$2 where id=$1",[first.id,randomUUID()]);
 const uploaded=new Map();
 const store={download:async()=>({data:new Blob(['template'])}),upload:async(path,bytes)=>{uploaded.set(path,bytes);return {};},remove:async paths=>{paths.forEach(p=>uploaded.delete(p));return {};}};
 const runTask=async data=>{assert.equal(data.responses[0].data.answer,'snapshot');return {bytes:Buffer.from('zip'),files:['one.docx']};};
 assert.equal(await processGenerationJob({pool,store,runTask}),true);
 const {rows:[done]}=await pool.query('select * from public.office_generation_jobs where id=$1',[first.id]);
 assert.equal(done.state,'succeeded');assert.equal(done.attempts,2);assert.equal(done.payload,null);
 const {rows:[result]}=await pool.query('select * from public.office_generation_results where id=$1',[first.id]);
 assert.ok(uploaded.has(result.storage_path));
 // Another process holding the lock prevents work across replicas.
 const lock=await pool.connect();
 await lock.query("select pg_advisory_lock(hashtextextended('survey-office-generation-worker',0))");
 assert.equal(await processGenerationJob({pool,store,runTask}),false);
 await lock.query("select pg_advisory_unlock(hashtextextended('survey-office-generation-worker',0))");lock.release();
 // A disabled employee cannot have queued work executed.
 await pool.query('update public.profiles set is_disabled=true where id=$1',[owner]);
 assert.equal(await processGenerationJob({pool,store,runTask}),true);
 assert.equal((await pool.query('select state from public.office_generation_jobs where id=$1',[second.id])).rows[0].state,'failed');
 assert.equal(uploaded.size,1);
 await pool.query('update public.profiles set is_disabled=false where id=$1',[owner]);
 // A replaced attempt token must not publish or delete another worker's result.
 const third=await enqueueGeneration(pool,doc,owner,[response]);
 await processGenerationJob({pool,store,runTask:async()=>{await pool.query('update public.office_generation_jobs set attempt_token=$2 where id=$1',[third.id,randomUUID()]);return {bytes:Buffer.from('zip'),files:['one.docx']};}});
 assert.equal((await pool.query('select id from public.office_generation_results where id=$1',[third.id])).rowCount,0);
 assert.equal(uploaded.size,1);
 await processGenerationJob({pool,store,runTask:async()=>{throw new HttpError(429,'Busy');}});
 const {rows:[retry]}=await pool.query('select state,payload,available_at>now() as delayed from public.office_generation_jobs where id=$1',[third.id]);
 assert.equal(retry.state,'queued');assert.ok(retry.payload);assert.equal(retry.delayed,true);
 assert.equal((await pool.query("select has_table_privilege('anon','public.office_generation_jobs','select') as allowed")).rows[0].allowed,false);
});
