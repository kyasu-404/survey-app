import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../public/plugin/plugins.js',import.meta.url),'utf8');
function setup({topLevel=false,origin='https://docs.test'}={}) {
  let handler;
  const parent={postMessage(){}};
  const window={parent,origin:'https://forms.test',location:{search:''},addEventListener(type,fn){if(type==='message')handler=fn;}};
  if(topLevel)window.parent=window;
  const context={window,navigator:{userAgent:'test'},document:{body:{}},SURVEY_DOCUMENT_SERVER_ORIGIN:origin};
  vm.runInNewContext(source,context);
  window.Asc.plugin._initInternal=true;
  return {window,parent,send:(source,origin,data)=>handler({source,origin,data:JSON.stringify({type:'plugin_init',data})})};
}
test('rejects foreign origins, siblings, missing configuration and top-level windows before eval',()=>{
  for(const variant of ['foreign','sibling','unset','top']) {
    const s=setup({topLevel:variant==='top',origin:variant==='unset'?null:'https://docs.test'});
    s.send(variant==='sibling'?{}:s.parent,variant==='foreign'?'https://evil.test':'https://docs.test','window.marker=true');
    assert.equal(s.window.marker,undefined,variant);
    assert.equal(s.window.Asc.supportOrigins['https://evil.test'],undefined);
  }
});
test('preserves initial bootstrap from the configured DocumentServer parent and binds later messages',()=>{
  const s=setup();s.send(s.parent,'https://docs.test','window.marker=true');assert.equal(s.window.marker,true);
  let calls=0;s.window.plugin_onMessage=()=>calls++;
  s.send({},'https://docs.test','');s.send(s.parent,'https://evil.test','');assert.equal(calls,0);
  s.send(s.parent,'https://docs.test','');assert.equal(calls,1);
});
