import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';
import pg from 'pg';
import { HttpError, encrypt, sign, verify, documentKey } from '../src/security.mjs';
import { createApp } from '../src/app.mjs';
import { blankDocx } from '../src/docx.mjs';
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
 await pool.query("insert into public.office_documents(id,form_id,name,file_type,storage_path,size_bytes,created_by,updated_by,template_field_count) values($1,$2,'Test.docx','docx','forms/test/source.docx',10,$3,$3,1)",[doc,form,owner]);
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

test('Office HTTP save persists bindings in PostgreSQL and generates from the committed Storage object', {skip:!url}, async t=>{
 assert.equal(new URL(url).pathname,'/office_integration_test','Use an isolated test database');
 const pool=new pg.Pool({connectionString:url,max:5});
 const owner=randomUUID(),form=randomUUID(),question=randomUUID(),responseId=randomUUID();
 const key=randomBytes(32),secret='isolated-document-server';
 const objects=new Map();let failUpload=false,commandError=0,documentId,base;
 let template;
 const store={
  upload:async(path,bytes)=>{if(failUpload)return {error:new Error('Storage unavailable')};objects.set(path,Buffer.from(bytes));return {};},
  download:async path=>objects.has(path) ? {data:new Blob([objects.get(path)])} : {error:new Error('Missing object')},
  remove:async paths=>{paths.forEach(path=>objects.delete(path));return {};},
 };
 const s={enabled:true,public_url:'https://docs.fixture.test',internal_url:'http://document-server.fixture.test',storage_url_override:'',jwt_header:'AuthorizationJwt',jwt_prefix:'Bearer ',jwt_secret_encrypted:encrypt(secret,key),max_file_mb:25};
 // Keep real PostgreSQL and all HTTP/worker paths; replace only external Auth,
 // Storage transport and Document Server with deterministic peers.
 const realQuery=pool.query.bind(pool);
 pool.query=(sql,args)=>sql.includes('select * from public.onlyoffice_settings') ? Promise.resolve({rows:[s]}) : realQuery(sql,args);
 const supabase={storage:{from:()=>store},auth:{getUser:async token=>({data:{user:token==='fixture' ? {id:owner} : null}})}};
 const server=createServer(createApp({pool,supabase,env:{PUBLIC_APP_URL:'https://forms.fixture.test',ONLYOFFICE_SETTINGS_ENCRYPTION_KEY:key.toString('base64')}}));
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 base=`http://127.0.0.1:${server.address().port}/api/office`;
 t.after(async()=>{
  await new Promise(resolve=>server.close(resolve));
  try{await realQuery('delete from public.forms where id=$1',[form]);await realQuery('delete from auth.users where id=$1',[owner]);}
  finally{await pool.end();}
 });
 const callback=async(status,lastsave,sessionKey)=>fetch(`${base}/callback/${documentId}`,{method:'POST',headers:{AuthorizationJwt:'Bearer '+sign({payload:{key:sessionKey,status,lastsave,url:s.public_url+'/cache/files/template.docx',users:[owner]}},secret)},body:'{}'});
 const originalFetch=globalThis.fetch;
 const pendingCallbacks=[];
 t.mock.method(globalThis,'fetch',async(input,options)=>{
  if(String(input)===s.internal_url+'/command'){
   const payload=verify(JSON.parse(options.body).token,secret);
   assert.equal(payload.c,'forcesave');
   if(!commandError)pendingCallbacks.push(callback(6,'2026-10-30T07:34:45.000Z',payload.key).then(async r=>assert.equal(r.status,200,await r.text())));
   return Response.json({error:commandError});
  }
  if(String(input).startsWith(s.internal_url+'/cache/files/'))return new Response(template);
  return originalFetch(input,options);
 });
 const request=(path,options={})=>fetch(base+path,{...options,headers:{Authorization:'Bearer fixture',...options.headers}});
 await realQuery("insert into auth.users(id,email,raw_user_meta_data) values($1,'office-save@example.invalid','{}')",[owner]);
 const {rows:[persisted]}=await realQuery("insert into public.forms(id,title,author_id,is_public,form_type,form_reason,schema) values($1,'Persistence fixture',$2,true,'anketa','plan',$3) returning schema",[form,owner,JSON.stringify({pages:[{elements:[{type:'text',name:'answer',integrationId:question,title:'Вопрос'}]}]})]);
 // PostgreSQL assigns the canonical integration ID on creation, just as in UI.
 const files=unzipSync(blankDocx());
 const control=`<w:sdt><w:sdtPr><w:tag w:val="survey-question:${persisted.schema.pages[0].elements[0].integrationId}"/></w:sdtPr><w:sdtContent><w:r><w:t>[Вопрос]</w:t></w:r></w:sdtContent></w:sdt>`;
 files['word/document.xml']=strToU8(`<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p>${control}${control}</w:p></w:body></w:document>`);
 template=Buffer.from(zipSync(files));
 await realQuery('insert into public.responses(id,form_id,data) values($1,$2,$3)',[responseId,form,JSON.stringify({answer:'Сохранённый ответ'})]);
 const created=await request(`/forms/${form}/documents?name=Uploaded.docx`,{method:'POST',headers:{'Content-Type':'application/octet-stream'},body:template});
 assert.equal(created.status,201);const doc=await created.json();documentId=doc.id;
 assert.equal(doc.template_field_count,2,'Uploaded content controls must survive without a bindings table');
 const config=await (await request(`/documents/${doc.id}/editor-config`)).json();
 assert.equal(verify(config.config.token,secret).document.key,documentKey(doc));
 const saved=await request(`/documents/${doc.id}/save`,{method:'POST'});
 assert.equal(saved.status,200,await saved.text());await Promise.all(pendingCallbacks);
 let current=(await realQuery('select * from public.office_documents where id=$1',[doc.id])).rows[0];
 assert.notEqual(current.storage_path,doc.storage_path);assert.equal(current.template_field_count,2);
 assert.equal(Number(current.last_force_save_at),Date.parse('2026-10-30T07:34:45.000Z'));assert.equal(current.version,1);
 assert.ok(current.last_callback_at);assert.equal(current.last_save_error,null);
 assert.equal((await (await request(`/documents/${doc.id}`)).json()).binding_count,2);
 const list=await (await request(`/forms/${form}/documents`)).json();assert.equal(list.documents[0].binding_count,2);
 const checked=await (await request(`/documents/${doc.id}/check-template`)).json();assert.equal(checked.fields.length,2);assert.ok(checked.fields.every(field=>!field.error),JSON.stringify(checked.fields));
 assert.deepEqual(Buffer.from(await (await request(`/documents/${doc.id}/download`)).arrayBuffer()),template);
 const queued=await request(`/documents/${doc.id}/generate`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({response_ids:[responseId]})});
 assert.equal(queued.status,202);const job=await queued.json();
 assert.equal(await processGenerationJob({pool,store}),true);
 const results=await (await request(`/forms/${form}/results`)).json();assert.equal(results.results[0].id,job.id);assert.equal(results.jobs.length,0);
 const archive=unzipSync(Buffer.from(await (await request(`/results/${job.id}/download`)).arrayBuffer()));
 const output=unzipSync(archive[results.results[0].files[0]]);
 assert.match(strFromU8(output['word/document.xml']),/Сохранённый ответ/);
 assert.doesNotMatch(strFromU8(output['word/document.xml']),/survey-question:/);
 assert.equal((await callback(2,'2026-10-30T07:34:45.000Z',documentKey(doc))).status,200);
 current=(await realQuery('select * from public.office_documents where id=$1',[doc.id])).rows[0];assert.equal(current.version,2);
 failUpload=true;
 assert.equal((await callback(6,'2026-10-30T07:35:00.000Z',documentKey(current))).status,502);
 current=(await realQuery('select * from public.office_documents where id=$1',[doc.id])).rows[0];assert.ok(current.last_save_error);assert.ok(current.last_save_error_at);
 commandError=4;
 assert.equal((await request(`/documents/${doc.id}/save`,{method:'POST'})).status,502,'An unchanged command must not hide a failed Storage write');
 failUpload=false;
 assert.equal((await callback(6,'2026-10-30T07:35:01.000Z',documentKey(current))).status,200);
 assert.equal((await request(`/documents/${doc.id}/save`,{method:'POST'})).status,200);
});
