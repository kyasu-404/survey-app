import test from 'node:test';
import assert from 'node:assert/strict';
import {unzipSync,zipSync,strToU8} from 'fflate';
import {createServer,request as httpRequest} from 'node:http';
import {Readable} from 'node:stream';
import {randomBytes,randomUUID} from 'node:crypto';
import {createApp} from '../src/app.mjs';
import {encrypt,sign,documentKey} from '../src/security.mjs';
const key=randomBytes(32),secret='document-server-test-secret',formId=randomUUID(),documentId=randomUUID(),userId=randomUUID();
const settings={enabled:true,public_url:'https://docs.test',internal_url:'http://onlyoffice',storage_url_override:'',jwt_secret_encrypted:encrypt(secret,key),jwt_header:'AuthorizationJwt',jwt_prefix:'Bearer ',max_file_mb:25,max_table_rows:1000};
const doc={id:documentId,form_id:formId,version:2,created_by:userId,storage_path:'private/file.docx',name:'Test.docx',file_type:'docx',template_field_count:1};
async function setup(t,{env={},disabled=false,role='user',result,commandResult,resultsFeed,documentAtRead,resultStream}={}){
 const statements=[];
 const downloadPaths=[];
 let documentReads=0;
 const query=async(sql,args=[])=>{
  statements.push({sql,args});
  if(sql.includes('as total'))return {rows:[{total:0,own:0,bytes:0}]};
  if(sql.startsWith('select to_jsonb(f)'))return {rows:[{form:{id:formId},responses:[{id:userId,data:{}}],organizations:[]}]};
  if(sql.startsWith('insert into public.office_generation_jobs'))return {rows:[{id:randomUUID(),form_id:formId,state:'queued'}]};
  if(sql.includes('onlyoffice_settings'))return {rows:[settings]};
  if(sql.includes('select id,name,role,is_disabled'))return {rows:[{id:userId,role,is_disabled:disabled,name:'Test'}]};
  if(sql.startsWith('select * from public.office_generation_results'))return {rows:result?[result]:[]};
  if(sql.includes('public.office_generation_results') && sql.includes('public.office_generation_jobs'))return {rows:[resultsFeed]};
  if(sql.startsWith('select * from public.forms'))return {rows:[{id:formId}]};
  if(sql.startsWith('select * from public.office_documents')) {
   const current=documentAtRead ? documentAtRead(++documentReads) : doc;
   return {rows:current ? [{...current}] : []};
  }
  return {rows:[]};
 };
 const pool={query,connect:async()=>({query,release(){}})};
 const store={download(path){
  downloadPaths.push(path);
  if(!result) throw new Error('Unexpected Storage request');
  const data=new Blob([zipSync({'first.xlsx':strToU8('first'), 'second.xlsx':strToU8('second')})]);
  return Object.assign(Promise.resolve({data}),{asStream:async()=>({data:resultStream?.() ?? data.stream()})});
 },upload(){throw new Error('Unexpected Storage request');}};
 const supabase={storage:{from:()=>store},auth:{getUser:async(token)=>({data:{user:token==='employee' ? {id:userId}:null},error:token==='employee' ? null : new Error()})}};
 if(commandResult) {
  const originalFetch=globalThis.fetch;
  t.mock.method(globalThis,'fetch',(url,options)=>String(url)==='http://onlyoffice/command'
   ? Promise.resolve(Response.json(commandResult)) : originalFetch(url,options));
 }
 const app=createApp({pool,supabase,env:{PUBLIC_APP_URL:'https://forms.test',OFFICE_DOCUMENT_SERVER_ORIGINS:'https://docs.test,http://onlyoffice',ONLYOFFICE_SETTINGS_ENCRYPTION_KEY:key.toString('base64'),...env}});
 const server=createServer(app);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(r=>server.close(r)));
 const base=`http://127.0.0.1:${server.address().port}/api/office`;
 const requestAtHost=(path,Host)=>new Promise((resolve,reject)=>{
  const request=httpRequest(base+path,{headers:{Host}},response=>{
   resolve(new Response(Readable.toWeb(response),{status:response.statusCode,headers:response.headers}));
  });
  request.on('error',reject).end();
 });
 return {statements,downloadPaths,requestAtHost,request:(path,options)=>fetch(base+path,options)};
}
test('anonymous and disabled employees cannot read documents',async t=>{
 const a=await setup(t);assert.equal((await a.request(`/documents/${documentId}`)).status,401);
 const b=await setup(t,{disabled:true});assert.equal((await b.request(`/documents/${documentId}`,{headers:{Authorization:'Bearer employee'}})).status,403);
});
test('plugin capabilities are document scoped, cannot read settings or mint editor configs',async t=>{
 const {request}=await setup(t,{role:'admin'});
 const token=sign({purpose:'plugin',exp:Math.floor(Date.now()/1000)+300,sub:userId,formId,documentId:randomUUID()},key.toString('hex')+':survey-office-capability-v1');
 const headers={Authorization:'Bearer '+token};
 assert.equal((await request(`/documents/${documentId}/bindings`,{headers})).status,403);
 assert.equal((await request('/settings',{headers})).status,403);
});
test('settings never expose encrypted or decrypted secrets',async t=>{
 const {request}=await setup(t,{role:'admin'});const response=await request('/settings',{headers:{Authorization:'Bearer employee'}});assert.equal(response.status,200);
 const data=await response.json();assert.equal(data.has_secret,true);assert.equal(data.jwt_secret_encrypted,undefined);assert.ok(!JSON.stringify(data).includes(secret));
});
test('callback requires the configured header signature and uses signed fields only',async t=>{
 const {request,statements}=await setup(t);
 const payload={key:documentKey(doc),status:1};
 let r=await request(`/callback/${documentId}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});assert.equal(r.status,401);
 r=await request(`/callback/${documentId}`,{method:'POST',headers:{'Content-Type':'application/json',AuthorizationJwt:'Bearer '+sign({payload},secret)},body:JSON.stringify({key:documentKey(doc),status:2,url:'http://evil.test/private'})});
 assert.equal(r.status,200);assert.deepEqual(await r.json(),{error:0});assert.ok(!statements.some(s=>s.sql.includes('storage_path=$2')));
});
test('old callback retries are acknowledged without changing the current file; future keys are rejected',async t=>{
 const {request,statements}=await setup(t);
 for(const [version,status] of [[1,200],[99,409]]) {
  const payload={key:documentKey({...doc,version}),status:2,url:'http://evil.test/private'};
  const response=await request(`/callback/${documentId}`,{method:'POST',headers:{'Content-Type':'application/json',AuthorizationJwt:'Bearer '+sign({payload},secret)},body:'{}'});
  assert.equal(response.status,status);
 }
 assert.ok(!statements.some(s=>s.sql.includes('storage_path=$2')));
 assert.ok(!statements.some(s=>s.sql.includes('set last_save_error=')));
});

test('non-saving callbacks and invalid keys never record a save failure',async t=>{
 const {request,statements}=await setup(t);
 for(const status of [1,4]) for(const valid of [true,false]) {
  const payload={key:valid ? documentKey(doc) : 'wrong-key',status};
  const r=await request(`/callback/${documentId}`,{method:'POST',headers:{AuthorizationJwt:'Bearer '+sign({payload},secret)},body:'{}'});
  assert.equal(r.status,valid ? 200 : 409);
 }
 assert.ok(!statements.some(s=>s.sql.includes('set last_save_error=')));
});
test('bad save origin is rejected before storage writes',async t=>{
 const {request,statements}=await setup(t);const payload={key:documentKey(doc),status:2,url:'http://169.254.169.254/cache/files/x'};
 const r=await request(`/callback/${documentId}`,{method:'POST',headers:{'Content-Type':'application/json',AuthorizationJwt:'Bearer '+sign({payload},secret)},body:'{}'});
 assert.equal(r.status,400);assert.ok(!statements.some(s=>s.sql.includes('storage_path=$2')));
 assert.ok(statements.some(s=>s.sql.includes('set last_save_error=$2')));
});

test('OnlyOffice save error statuses still record a save failure',async t=>{
 const {request,statements}=await setup(t);
 for(const status of [3,7]) {
  const payload={key:documentKey(doc),status};
  assert.equal((await request(`/callback/${documentId}`,{method:'POST',headers:{AuthorizationJwt:'Bearer '+sign({payload},secret)},body:'{}'})).status,200);
 }
 assert.equal(statements.filter(s=>s.sql.includes('set last_save_error=$2')).length,2);
});
test('cross-origin plugin configuration is public but data API origin is restricted',async t=>{
 const {request}=await setup(t);
 const config=await request('/plugin/config.json',{headers:{Origin:'https://docs.test'}});assert.equal(config.status,200);assert.equal(config.headers.get('access-control-allow-origin'),'*');
 assert.equal((await request('/settings',{headers:{Origin:'https://evil.test',Authorization:'Bearer employee'}})).status,403);
});
test('a configured browser origin can use the Office API and other origins stay restricted',async t=>{
 const localOrigin='http://127.0.0.1:5173';
 const {request}=await setup(t,{role:'admin',env:{OFFICE_ALLOWED_ORIGINS:` ${localOrigin}, http://localhost:5173 `}});
 for(const Origin of ['https://forms.test',localOrigin,'http://localhost:5173']){
  assert.equal((await request('/settings',{headers:{Origin,Authorization:'Bearer employee'}})).status,200);
 }
 for(const Origin of ['http://127.0.0.1:5174','http://127.0.0.1.test:5173','null']){
  assert.equal((await request('/settings',{headers:{Origin,Authorization:'Bearer employee'}})).status,403);
 }
 assert.equal((await request('/settings',{headers:{Origin:localOrigin}})).status,401);
 const production=await setup(t,{role:'admin'});
 assert.equal((await production.request('/settings',{headers:{Origin:localOrigin,Authorization:'Bearer employee'}})).status,403);
});
test('document-scoped plugin cannot start a batch generation or download source files',async t=>{
 const {request,statements}=await setup(t);
 const token=sign({purpose:'plugin',exp:Math.floor(Date.now()/1000)+300,sub:userId,formId,documentId},key.toString('hex')+':survey-office-capability-v1');
 const headers={Authorization:'Bearer '+token,'Content-Type':'application/json'};
 assert.equal((await request(`/documents/${documentId}/generate`,{method:'POST',headers,body:'{}'})).status,403);
 assert.equal((await request(`/documents/${documentId}/download`,{headers})).status,403);
 assert.ok(!statements.some(s=>s.sql.startsWith('select id,data')));
});
test('batch selections reject empty, duplicate and malformed response IDs before reading answers',async t=>{
 const {request,statements}=await setup(t);
 for(const ids of [[],[userId,userId],['invalid']]){
  const r=await request(`/documents/${documentId}/generate`,{method:'POST',headers:{Authorization:'Bearer employee','Content-Type':'application/json'},body:JSON.stringify({response_ids:ids})});assert.equal(r.status,400);
 }
 assert.ok(!statements.some(s=>s.sql.startsWith('select id,data')));
});

test('results require employee authentication and enforce creator/admin deletion',async t=>{
 const result={id:randomUUID(),created_by:randomUUID(),storage_path:'private/result.zip',files:['first.xlsx','second.xlsx'],file_type:'xlsx',name:'Result.zip'};
 const {request,statements,downloadPaths}=await setup(t,{result});
 assert.equal((await request(`/results/${result.id}/download`)).status,401);
 const token=sign({purpose:'plugin',exp:Math.floor(Date.now()/1000)+300,sub:userId,formId,documentId},key.toString('hex')+':survey-office-capability-v1');
 for(const path of [`/results/${result.id}/download`,`/forms/${formId}/results`,'/status'])assert.equal((await request(path,{headers:{Authorization:'Bearer '+token}})).status,403);
 const headers={Authorization:'Bearer employee'};
 assert.equal((await request(`/results/${result.id}`,{method:'DELETE',headers})).status,403);
 assert.ok(!statements.some(s=>s.sql.startsWith('delete from')));
 assert.equal((await request(`/results/${result.id}/files/9`,{headers})).status,404);
 assert.deepEqual(downloadPaths,[]);
 const file=await request(`/results/${result.id}/files/1`,{headers});assert.equal(file.status,200);assert.equal(await file.text(),'second');assert.match(file.headers.get('content-disposition'),/second.xlsx/);
 const archive=await request(`/results/${result.id}/download`,{headers});
 assert.equal(archive.headers.get('content-type'),'application/zip');
 assert.deepEqual(Object.keys(unzipSync(new Uint8Array(await archive.arrayBuffer()))),['first.xlsx','second.xlsx']);
 const admin=await setup(t,{result,role:'admin'});assert.equal((await admin.request(`/results/${result.id}`,{method:'DELETE',headers})).status,200);
 assert.ok(admin.statements.some(s=>s.sql.startsWith('delete from public.office_generation_results')));
});

test('the results feed reads archives and job states from one PostgreSQL snapshot',async t=>{
 const job={id:randomUUID(),form_id:formId,name:'Test.docx',state:'running',created_at:'2026-09-21T09:00:00.000Z'};
 const result={id:randomUUID(),form_id:formId,name:'Test.zip',files:['first.docx'],created_at:'2026-09-21T09:00:00.000Z'};
 const {request,statements}=await setup(t,{resultsFeed:{results:[result],jobs:[job]}});
 const response=await request(`/forms/${formId}/results`,{headers:{Authorization:'Bearer employee'}});
 assert.equal(response.status,200);
 assert.deepEqual(await response.json(),{results:[result],jobs:[job]});
 const feedReads=statements.filter(s=>s.sql.includes('public.office_generation_results') || s.sql.includes('public.office_generation_jobs'));
 assert.equal(feedReads.length,1);
 assert.deepEqual(feedReads[0].args,[formId]);
});

test('plugin bootstrap pins its origin from server settings, not request parameters',async t=>{
 const {request}=await setup(t);
 const r=await request('/plugin/plugins.js?origin=https://evil.test');assert.equal(r.status,200);
 assert.match(await r.text(),/^const SURVEY_DOCUMENT_SERVER_ORIGIN="https:\/\/docs.test";/);
});

test('valid generation queues a durable job without downloading or processing in the request',async t=>{
 const {request,statements}=await setup(t);
 const r=await request(`/documents/${documentId}/generate`,{method:'POST',headers:{Authorization:'Bearer employee','Content-Type':'application/json'},body:JSON.stringify({response_ids:[userId]})});
 assert.equal(r.status,202);assert.equal((await r.json()).state,'queued');
 assert.ok(statements.some(s=>s.sql.startsWith('insert into public.office_generation_jobs')));
});

test('force save waits past an old error until a new callback commits the file',async t=>{
 const previous={...doc,last_save_error:'Previous autosave failed',last_save_error_at:'2026-10-28T09:00:00Z'};
 const {request,statements}=await setup(t,{commandResult:{error:0},documentAtRead:n=>n<3 ? previous : {...previous,storage_path:'private/new.docx',last_save_error:null,last_save_error_at:null}});
 const r=await request(`/documents/${documentId}/save`,{method:'POST',headers:{Authorization:'Bearer employee'}});
 assert.equal(r.status,200);assert.deepEqual(await r.json(),{saved:true});
 assert.equal(statements.filter(s=>s.sql.startsWith('select * from public.office_documents')).length,3);
});

test('force save detects a fresh callback failure even when its message repeats',async t=>{
 const previous={...doc,last_save_error:'Same failure',last_save_error_at:'2026-10-28T09:00:00Z'};
 const {request}=await setup(t,{commandResult:{error:0},documentAtRead:n=>n===1 ? previous : {...previous,last_save_error_at:'2026-10-28T09:01:00Z'}});
 const r=await request(`/documents/${documentId}/save`,{method:'POST',headers:{Authorization:'Bearer employee'}});
 assert.equal(r.status,502);
});

test('force save with no changes succeeds immediately without polling',async t=>{
 const {request,statements}=await setup(t,{commandResult:{error:4}});
 const r=await request(`/documents/${documentId}/save`,{method:'POST',headers:{Authorization:'Bearer employee'}});
 assert.equal(r.status,200);assert.deepEqual(await r.json(),{saved:true,unchanged:true});
 assert.equal(statements.filter(s=>s.sql.startsWith('select * from public.office_documents')).length,2);
});

test('unchanged force save preserves an unconfirmed failure and blocks generation',async t=>{
 const current={...doc,last_save_error:'Old failure',last_save_error_at:'2026-10-28T09:00:00Z'};
 const {request}=await setup(t,{commandResult:{error:4},documentAtRead:()=>current});
 const headers={Authorization:'Bearer employee'};
 assert.equal((await request(`/documents/${documentId}/generate`,{method:'POST',headers})).status,409);
 const r=await request(`/documents/${documentId}/save`,{method:'POST',headers});
 assert.equal(r.status,502);
 assert.equal(current.last_save_error,'Old failure');
 assert.equal((await request(`/documents/${documentId}/generate`,{method:'POST',headers})).status,409);
});

test('unchanged force save accepts recovery only after a successful callback',async t=>{
 const previous={...doc,last_save_error:'Old failure'};
 const {request}=await setup(t,{commandResult:{error:4},documentAtRead:n=>n===1 ? previous : {...previous,storage_path:'private/saved.docx',last_save_error:null}});
 assert.equal((await request(`/documents/${documentId}/save`,{method:'POST',headers:{Authorization:'Bearer employee'}})).status,200);
});

test('templates without bound fields are rejected before a job is queued',async t=>{
 const {request,statements}=await setup(t,{documentAtRead:()=>({...doc,template_field_count:0})});
 const r=await request(`/documents/${documentId}/generate`,{method:'POST',headers:{Authorization:'Bearer employee'}});
 assert.equal(r.status,409);
 assert.match((await r.json()).message,/Данные формы/);
 assert.ok(!statements.some(s=>s.sql.startsWith('insert into public.office_generation_jobs')));
});

test('unchanged force save does not clear a concurrent callback failure',async t=>{
 const previous={...doc,last_save_error:'Same failure',last_save_error_at:'2026-10-28T09:00:00Z'};
 const {request}=await setup(t,{commandResult:{error:4},documentAtRead:n=>n===1 ? previous : {...previous,last_save_error_at:'2026-10-28T09:01:00Z'}});
 assert.equal((await request(`/documents/${documentId}/save`,{method:'POST',headers:{Authorization:'Bearer employee'}})).status,502);
});

test('force save notices document deletion while awaiting a callback',async t=>{
 const {request}=await setup(t,{commandResult:{error:0},documentAtRead:n=>n===1 ? doc : null});
 const r=await request(`/documents/${documentId}/save`,{method:'POST',headers:{Authorization:'Bearer employee'}});
 assert.equal(r.status,404);
});

test('OFFICE_EMBED_ORIGIN isolates editor frame and plugin origin while permitting parent framing and CORS',async t=>{
 const embed='https://office.forms.test';
 const {request,requestAtHost}=await setup(t,{env:{OFFICE_EMBED_ORIGIN:embed}});
 const cfg=await request(`/documents/${documentId}/editor-config`,{headers:{Authorization:'Bearer employee',Origin:'https://forms.test'}});
 assert.equal(cfg.status,200);
 assert.equal(cfg.headers.get('access-control-allow-origin'),'https://forms.test');
 const body=await cfg.json();
 assert.equal(body.embedOrigin,embed);
 assert.deepEqual(body.config.editorConfig.plugins.pluginsData,[`${embed}/api/office/plugin/config.json`]);
 const embedHost=new URL(embed).host;
 assert.equal((await requestAtHost('/editor-frame','forms.test')).status,404);
 assert.equal((await requestAtHost('/editor-bridge.js','forms.test')).status,404);
 assert.equal((await requestAtHost('/plugin/config.json','forms.test')).status,404);
 const plugin=await requestAtHost('/plugin/config.json',embedHost);
 assert.equal(plugin.status,200);
 const pluginAncestors=plugin.headers.get('content-security-policy').split(';').find(value=>value.trim().startsWith('frame-ancestors'));
 assert.ok(pluginAncestors.includes('https://forms.test'), 'The top-level Forms origin must be allowed to contain the plugin');
 assert.ok(pluginAncestors.includes(embed), 'The isolated editor frame must be allowed to contain the plugin');
 const frame=await requestAtHost('/editor-frame',embedHost);
 assert.equal(frame.status,200);
 assert.match(frame.headers.get('content-security-policy'),/frame-ancestors 'self' https:\/\/forms\.test https:\/\/office\.forms\.test/);
 const bridge=await requestAtHost('/editor-bridge.js',embedHost);
 assert.match(await bridge.text(),/^const SURVEY_APP_ORIGIN="https:\/\/forms\.test";/);
 assert.equal((await requestAtHost('/plugin/toString',embedHost)).status,404);
 const badCallback=await request(`/callback/${documentId}`,{method:'POST',headers:{'Content-Type':'application/json'},body:'not-json'});
 assert.equal(badCallback.status,400);
});

test('PUT /settings requires re-entering JWT secret when ONLYOFFICE URLs change',async t=>{
 const {request}=await setup(t,{role:'admin'});
 const r=await request('/settings',{method:'PUT',headers:{Authorization:'Bearer employee','Content-Type':'application/json'},body:JSON.stringify({
  enabled:true,public_url:'https://attacker.test',internal_url:'http://onlyoffice',storage_url_override:'',
  jwt_header:'AuthorizationJwt',jwt_prefix:'Bearer ',max_file_mb:25,max_table_rows:1000,
 })});
 assert.equal(r.status,400);
});

test('Office CORS permits a configured browser preflight before authentication',async t=>{
 const Origin='https://ui.test';
 const {request,statements}=await setup(t,{env:{OFFICE_ALLOWED_ORIGINS:Origin}});
 const response=await request('/settings',{method:'OPTIONS',headers:{
  Origin,'Access-Control-Request-Method':'PUT','Access-Control-Request-Headers':'Authorization, Content-Type'
 }});
 assert.equal(response.status,204);
 assert.equal(response.headers.get('access-control-allow-origin'),Origin);
 assert.equal(response.headers.get('vary'),'Origin');
 assert.match(response.headers.get('access-control-allow-methods'),/PUT/);
 assert.match(response.headers.get('access-control-allow-headers'),/Authorization, Content-Type/);
 assert.deepEqual(statements,[]);
});

test('Office settings accepts the exact public and private origins enrolled by the operator',async t=>{
 const {request,statements}=await setup(t,{role:'admin'});
 const handler=body=>request('/settings',{method:'PUT',headers:{Authorization:'Bearer employee','Content-Type':'application/json'},body:JSON.stringify(body)});
 const body={enabled:true,public_url:'https://docs.test/editor',internal_url:'http://onlyoffice',storage_url_override:'',
  jwt_header:'AuthorizationJwt',jwt_prefix:'Bearer ',jwt_secret:'replacement fixture',max_file_mb:25,max_table_rows:1000};
 assert.equal((await handler(body)).status,200);
 assert.equal((await handler({...body,public_url:'https://new-docs.test/editor'})).status,400);
 assert.equal(statements.filter(({sql})=>sql.startsWith('update public.onlyoffice_settings')).length,1);
});

test('result ZIP downloads reserve capacity before opening Storage and release it after streaming', async t => {
 const result={id:randomUUID(),storage_path:'private/result.zip',files:['first.xlsx'],file_type:'xlsx',name:'Result.zip'};
 const headers={Authorization:'Bearer employee'};
 const archive=zipSync({'first.xlsx':strToU8('first')});
 const streams=[];
 const {request,downloadPaths}=await setup(t,{result,resultStream:()=>new ReadableStream({
  start(controller) {
   streams.push(controller);
   controller.enqueue(archive.subarray(0,20));
  }
 })});
 const start=()=>request(`/results/${result.id}/download`,{headers});
 const downloads=[];
 try {
  await Promise.all([start(),start()].map(async request=>downloads.push(await request)));
  assert.ok(downloads.every(response=>response.status===200));
  assert.equal((await start()).status,429);
  assert.equal(downloadPaths.length,2);
 } finally {
  for(const controller of streams.splice(0)) {
   controller.enqueue(archive.subarray(20));
   controller.close();
  }
 }
 for(const response of downloads) assert.deepEqual(new Uint8Array(await response.arrayBuffer()),archive);
 const next=await start();
 assert.equal(next.status,200);
 for(const controller of streams) controller.close();
 await next.arrayBuffer();
 assert.equal(downloadPaths.length,3);
});
