import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';
import ts from '../../frontend/node_modules/typescript/lib/typescript.js';
import * as favicon from './favicon.mjs';
const require=createRequire(new URL('../../office-service/package.json',import.meta.url));
const xml=require('fast-xml-parser');
const code=ts.transpileModule(readFileSync(new URL('./index.ts',import.meta.url),'utf8').replace(/^import .*;\n/gm,''),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
function setup({role='admin',disabled=false,rpcError=false}={}) {
 let handler;const uploads=[],removals=[],rpcs=[];
 const client={auth:{getUser:async()=>({data:{user:{id:'admin'}}})},from:()=>({select(){return this;},eq(){return this;},single:async()=>({data:{role,is_disabled:disabled}})}),
  storage:{from:bucket=>({upload:async(path,bytes,options)=>{uploads.push({bucket,path,bytes,options});return {};},remove:async paths=>{removals.push(paths);return {};}})},
  rpc:async(name,args)=>{rpcs.push({name,args});return rpcError?{error:new Error('database unavailable')}:{data:{path:args.p_path,mime:args.p_mime,previousPath:'favicon-old.png',updatedAt:'now'}};}};
 const deps={createClient:()=>client,...xml,...favicon,crypto:webcrypto,console:{error(){}},Deno:{env:{get:key=>key==='MAIL_ADMIN_ALLOWED_ORIGINS'?'https://forms.test':'configured'},serve:fn=>{handler=fn;}}};
 new Function(...Object.keys(deps),code)(...Object.values(deps));
 return {uploads,removals,rpcs,async request(payload,authorization=true){const response=await handler(new Request('https://api.test/app-settings',{method:'POST',headers:{Origin:'https://forms.test',...(authorization?{Authorization:'Bearer test'}:{})},body:JSON.stringify(payload)}));return {status:response.status,body:await response.json()};}};
}
const image=readFileSync(new URL('../../frontend/src/img/favicon.png',import.meta.url)).toString('base64');
test('favicon handler validates bytes, assigns its own filename/type and switches metadata before cleanup',async()=>{
 const app=setup();const result=await app.request({action:'upload-favicon',fileName:'my.png',base64:image,mime:'text/html'});
 assert.equal(result.status,200);assert.equal(app.uploads[0].options.contentType,'image/png');assert.match(app.uploads[0].path,/^favicon-[0-9a-f-]+\.png$/);
 assert.equal(app.rpcs[0].name,'set_app_favicon');assert.deepEqual(app.removals,[['favicon-old.png']]);assert.equal(result.body.previousPath,undefined);
});
test('rejects spoofed images and regular/disabled accounts before any upload',async()=>{
 for(const options of [{role:'user'},{disabled:true}]) {const app=setup(options);assert.equal((await app.request({action:'upload-favicon',fileName:'x.png',base64:image})).status,403);assert.equal(app.uploads.length,0);}
 const app=setup();assert.equal((await app.request({action:'upload-favicon',fileName:'fake.png',base64:btoa('<script/>')})).status,400);
 assert.equal((await app.request({action:'reset-favicon'},false)).status,401);assert.equal(app.uploads.length,0);
});
test('reset restores default and failed metadata save cleans up the new upload',async()=>{
 const app=setup();assert.equal((await app.request({action:'reset-favicon'})).body.path,null);assert.equal(app.uploads.length,0);
 const broken=setup({rpcError:true});assert.equal((await broken.request({action:'upload-favicon',fileName:'icon.png',base64:image})).status,500);
 assert.deepEqual(broken.removals,[[broken.uploads[0].path]]);
});
