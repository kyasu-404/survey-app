import test from 'node:test';
import assert from 'node:assert/strict';
import {zipSync,strToU8} from 'fflate';
import {createServer} from 'node:http';
import {randomBytes,randomUUID} from 'node:crypto';
import {createApp} from '../src/app.mjs';
import {encrypt,sign,documentKey} from '../src/security.mjs';
const key=randomBytes(32),secret='document-server-test-secret',formId=randomUUID(),documentId=randomUUID(),userId=randomUUID();
const settings={enabled:true,public_url:'https://docs.test',internal_url:'http://onlyoffice',storage_url_override:'',jwt_secret_encrypted:encrypt(secret,key),jwt_header:'AuthorizationJwt',jwt_prefix:'Bearer ',max_file_mb:25,max_table_rows:1000};
const doc={id:documentId,form_id:formId,version:2,created_by:userId,storage_path:'private/file.docx',name:'Test.docx'};
async function setup(t,{disabled=false,role='user',result}={}){
 const statements=[];
 const query=async(sql,args=[])=>{
  statements.push({sql,args});
  if(sql.includes('onlyoffice_settings'))return {rows:[settings]};
  if(sql.includes('select id,name,role,is_disabled'))return {rows:[{id:userId,role,is_disabled:disabled,name:'Test'}]};
  if(sql.startsWith('select * from public.office_generation_results'))return {rows:result?[result]:[]};
  if(sql.startsWith('select * from public.forms'))return {rows:[{id:formId}]};
  if(sql.startsWith('select * from public.office_documents'))return {rows:[doc]};
  return {rows:[]};
 };
 const pool={query,connect:async()=>({query,release(){}})};
 const store={download(){if(result)return {data:new Blob([zipSync({'first.xlsx':strToU8('first'), 'second.xlsx':strToU8('second')})])};throw new Error('Unexpected Storage request');},upload(){throw new Error('Unexpected Storage request');}};
 const supabase={storage:{from:()=>store},auth:{getUser:async(token)=>({data:{user:token==='employee' ? {id:userId}:null},error:token==='employee' ? null : new Error()})}};
 const app=createApp({pool,supabase,env:{PUBLIC_APP_URL:'https://forms.test',ONLYOFFICE_SETTINGS_ENCRYPTION_KEY:key.toString('base64')}});
 const server=createServer(app);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(r=>server.close(r)));
 const base=`http://127.0.0.1:${server.address().port}/api/office`;
 return {statements,request:(path,options)=>fetch(base+path,options)};
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
});
test('bad save origin is rejected before storage writes',async t=>{
 const {request,statements}=await setup(t);const payload={key:documentKey(doc),status:2,url:'http://169.254.169.254/cache/files/x'};
 const r=await request(`/callback/${documentId}`,{method:'POST',headers:{'Content-Type':'application/json',AuthorizationJwt:'Bearer '+sign({payload},secret)},body:'{}'});
 assert.equal(r.status,400);assert.ok(!statements.some(s=>s.sql.includes('storage_path=$2')));
});
test('cross-origin plugin configuration is public but data API origin is restricted',async t=>{
 const {request}=await setup(t);
 const config=await request('/plugin/config.json',{headers:{Origin:'https://docs.test'}});assert.equal(config.status,200);assert.equal(config.headers.get('access-control-allow-origin'),'*');
 assert.equal((await request('/settings',{headers:{Origin:'https://evil.test',Authorization:'Bearer employee'}})).status,403);
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
 const {request,statements}=await setup(t,{result});
 assert.equal((await request(`/results/${result.id}/download`)).status,401);
 const token=sign({purpose:'plugin',exp:Math.floor(Date.now()/1000)+300,sub:userId,formId,documentId},key.toString('hex')+':survey-office-capability-v1');
 for(const path of [`/results/${result.id}/download`,`/forms/${formId}/results`,'/status'])assert.equal((await request(path,{headers:{Authorization:'Bearer '+token}})).status,403);
 const headers={Authorization:'Bearer employee'};
 assert.equal((await request(`/results/${result.id}`,{method:'DELETE',headers})).status,403);
 assert.ok(!statements.some(s=>s.sql.startsWith('delete from')));
 const file=await request(`/results/${result.id}/files/1`,{headers});assert.equal(file.status,200);assert.equal(await file.text(),'second');assert.match(file.headers.get('content-disposition'),/second.xlsx/);
 assert.equal((await request(`/results/${result.id}/files/9`,{headers})).status,404);
 const admin=await setup(t,{result,role:'admin'});assert.equal((await admin.request(`/results/${result.id}`,{method:'DELETE',headers})).status,200);
 assert.ok(admin.statements.some(s=>s.sql.startsWith('delete from public.office_generation_results')));
});
