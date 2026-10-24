const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const {createRoot} = require('react-dom/client');
const {JSDOM} = require('jsdom');
const {act} = React;
function load(file, deps={}) {
 const module={exports:{}};
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,
  {module,exports:module.exports,Promise,Map,Set,Error,require:name=>deps[name]||require(name)});
 return module.exports;
}
const paging=load('lib/supabase/readAll.ts');
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
async function setup({canEdit=true,superAdmin=false,parent=null,override}={}) {
 const dom=new JSDOM('<div id="root"></div>',{url:'https://example.test'});
 global.window=dom.window;global.document=dom.window.document;global.HTMLElement=dom.window.HTMLElement;global.IS_REACT_ACT_ENVIRONMENT=true;
 const calls=[];
 const venues=[{id:'venue-a',name:'Park',city:'City',state:'IA',address:'123 Park'},{id:'venue-b',name:'Other Park',city:'City',state:'IA',address:'456 Park'}];
 function query(call) {
  calls.push(call);
  const q={then:(resolve,reject)=>Promise.resolve().then(()=>{
   const custom=override?.(call);if(custom!==undefined)return custom;
   if(call.rpc==='is_super_admin')return {data:superAdmin,error:null};
   if(call.rpc==='get_location_venue_options')return {data:venues,error:null};
   if(call.rpc==='set_location_venue'){parent=call.args.p_venue_id;return {data:parent,error:null};}
   if(call.table==='locations')return {data:[{id:'field-a',venue_id:parent},{id:'field-b',venue_id:'venue-b'}],error:null};
   if(call.table==='venues')return {data:{id:call.filters.find(f=>f[0]==='eq')?.[2]||'created-venue'},error:null};
   return {data:[],error:null};
  }).then(resolve,reject)};
  for(const method of ['select','in','eq','order','range','update','insert','single'])q[method]=(...args)=>{call.filters.push([method,...args]);return q;};
  return q;
 }
 const client={from:table=>query({table,filters:[]}),rpc:(rpc,args)=>query({rpc,args,filters:[]})};
 const Component=load('components/LocationVenueStructure.tsx', {'../lib/supabase/client':{createClient:()=>client},'../lib/supabase/readAll':paging}).default;
 const root=createRoot(document.getElementById('root'));
 let props={fields:[{id:'field-a',name:'Field A'},{id:'field-b',name:'Field B'}],scopeKey:'org-a',canEdit,children:React.createElement('p',null,'Existing locations editor')};
 const render=async change=>{props={...props,...change};await act(async()=>{root.render(React.createElement(Component,props));});};
 const button=text=>[...document.querySelectorAll('button')].find(el=>el.textContent===text);
 const select=label=>document.querySelector(`select[aria-label="${label}"]`);
 const click=async el=>{assert(el,'Expected button');await act(async()=>el.dispatchEvent(new window.MouseEvent('click',{bubbles:true})));};
 const change=async(el,value)=>{assert(el,'Expected input');await act(async()=>{const setter=Object.getOwnPropertyDescriptor(el.tagName==='SELECT'?window.HTMLSelectElement.prototype:window.HTMLInputElement.prototype,'value').set;setter.call(el,value);el.dispatchEvent(new window.Event('change',{bubbles:true}));el.dispatchEvent(new window.Event('input',{bubbles:true}));});};
 const close=async()=>{await act(async()=>root.unmount());dom.window.close();};
 await render();return {calls,render,button,select,click,change,close,text:()=>document.body.textContent,props};
}
test('Locations keeps explicit association pathway with bounded reads and separate screens',async()=>{
 const t=await setup();try {
  assert(t.text().includes('Assign fields to venues'));assert(t.text().includes('Existing locations editor'));
  const read=t.calls.find(c=>c.table==='locations');assert.deepEqual(JSON.parse(JSON.stringify(read.filters.find(f=>f[0]==='in'))),['in','id',['field-a','field-b']]);
  assert(read.filters.some(f=>f[0]==='range'));
  assert.equal(t.select('Parent venue for Field A').value,'');
  await t.click(t.button('Venues'));assert(t.text().includes('Venue directory'));assert(!t.text().includes('Existing locations editor'));assert(!t.button('Save venue record'));assert(!t.button('Edit venue'));
  await t.click(t.button('Fields'));assert(t.select('Parent venue for Field A'));
 } finally {await t.close();}
});
test('assign, change and unassign use saved UUID and expected old UUID; repeated clicks serialize',async()=>{
 const pending=deferred();let block=true;
 const t=await setup({override:call=>call.rpc==='set_location_venue'&&block?pending.promise:undefined});try {
  await t.change(t.select('Parent venue for Field A'),'venue-a');
  await t.click(t.button('Save venue'));assert(t.button('Saving…').disabled);
  await t.click(t.button('Saving…'));assert.equal(t.calls.filter(c=>c.rpc==='set_location_venue').length,1);
  assert.deepEqual(JSON.parse(JSON.stringify(t.calls.find(c=>c.rpc==='set_location_venue').args)),{p_location_id:'field-a',p_venue_id:'venue-a',p_expected_venue_id:null});
  block=false;await act(async()=>pending.resolve({data:'venue-a',error:null}));
  assert(t.text().includes('Field ID, games and assignments were not changed'));
  await t.change(t.select('Parent venue for Field A'),'venue-b');await t.click(t.button('Save venue'));
  let saved=t.calls.filter(c=>c.rpc==='set_location_venue').at(-1);assert.equal(saved.args.p_expected_venue_id,'venue-a');assert.equal(saved.args.p_venue_id,'venue-b');
  await t.change(t.select('Parent venue for Field A'),'');await t.click(t.button('Save venue'));
  saved=t.calls.filter(c=>c.rpc==='set_location_venue').at(-1);assert.equal(saved.args.p_expected_venue_id,'venue-b');assert.equal(saved.args.p_venue_id,null);
  assert(!t.calls.some(c=>['games','assignments'].includes(c.table)));
 } finally {await t.close();}
});
test('Unassigned venue filter selects actual null parents, not name similarity',async()=>{
 const t=await setup();try {
  await t.change(t.select('Venue association filter'),'unassigned');assert(t.select('Parent venue for Field A'));assert(!t.select('Parent venue for Field B'));
  await t.change(t.select('Parent venue for Field A'),'venue-a');await t.click(t.button('Save venue'));
  assert(t.text().includes('No fields match this filter'));assert(!t.select('Parent venue for Field A'));
 } finally {await t.close();}
});
test('restricted users perform no reads or writes and expose no association controls',async()=>{
 const t=await setup({canEdit:false});try {assert.equal(t.calls.length,0);assert(!t.select('Parent venue for Field A'));assert(!t.button('Save venue'));} finally {await t.close();}
});
test('rejected association preserves current parent and reports error without success',async()=>{
 const t=await setup({parent:'venue-a',override:call=>call.rpc==='set_location_venue'?{data:null,error:{message:'Access denied or parent changed'}}:undefined});try {
  await t.change(t.select('Parent venue for Field A'),'venue-b');await t.click(t.button('Save venue'));
  assert(t.text().includes('Access denied or parent changed'));assert(!t.text().includes('venue saved'));
  await t.click(t.button('Refresh venue relationships'));assert.equal(t.select('Parent venue for Field A').value,'venue-a');
 } finally {await t.close();}
});
test('late association responses cannot repopulate a changed scope or revoked manager',async()=>{
 for(const next of [{scopeKey:'org-b'},{canEdit:false}]) {
  const pending=deferred();const t=await setup({override:call=>call.rpc==='set_location_venue'?pending.promise:undefined});try {
   await t.change(t.select('Parent venue for Field A'),'venue-a');await t.click(t.button('Save venue'));
   await t.render(next);await act(async()=>pending.resolve({data:'venue-a',error:null}));
   assert(!t.text().includes('Field A: venue saved'));if(next.scopeKey)assert.equal(t.select('Parent venue for Field A').value,'');
  } finally {await t.close();}
 }
});
test('unmounted association component ignores pending response',async()=>{
 const pending=deferred();const t=await setup({override:call=>call.rpc==='set_location_venue'?pending.promise:undefined});
 await t.change(t.select('Parent venue for Field A'),'venue-a');await t.click(t.button('Save venue'));await t.close();await act(async()=>pending.resolve({data:'venue-a',error:null}));
 assert.equal(t.calls.filter(c=>c.rpc==='set_location_venue').length,1);
});
test('superadmin venue edits preserve the venue ID and cancel makes no mutation',async()=>{
 const t=await setup({superAdmin:true});try {
  await t.click(t.button('Venues'));assert(t.button('Save venue record'));
  await t.click(t.button('Edit venue'));await t.click(t.button('Cancel venue edit'));assert(!t.calls.some(c=>c.table==='venues'));
  await t.click(t.button('Edit venue'));await act(async()=>document.querySelector('form').dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true})));
  const write=t.calls.find(c=>c.table==='venues');assert(write.filters.some(f=>f[0]==='update'));assert(write.filters.some(f=>f[0]==='eq'&&f[1]==='id'&&f[2]==='venue-b')); // sorted Other Park first
  assert(!t.calls.some(c=>c.rpc==='set_location_venue'));assert(t.text().includes('Existing field associations were not changed'));
 } finally {await t.close();}
});
test('GameSetup embeds the pathway directly inside existing Locations management',()=>{
 const source=fs.readFileSync('components/GameSetup.tsx','utf8');
 assert(source.includes('<LocationVenueStructure key={accessScopeKey} fields={locations} scopeKey={accessScopeKey} canEdit={canEditDirectory()}>'));
 assert(source.includes('set_organization_field_complex'));assert(source.includes('<LocationsRosterManager />'));
});
test('late catalog reads and read failures never enable stale association controls',async()=>{
 const pending=deferred();let first=true;
 const t=await setup({override:call=>call.rpc==='get_location_venue_options'&&first?(first=false,pending.promise):undefined});try {
  assert(!t.select('Parent venue for Field A'));
  await t.render({scopeKey:'org-b'});assert(t.select('Parent venue for Field A'));
  await act(async()=>pending.resolve({data:[{id:'old-secret',name:'OLD SCOPE VENUE'}],error:null}));assert(!t.text().includes('OLD SCOPE VENUE'));
 } finally {await t.close();}
 const failed=await setup({override:call=>call.rpc==='get_location_venue_options'?{data:null,error:{message:'Venue directory unavailable'}}:undefined});try {
  assert(failed.text().includes('Venue directory unavailable'));assert(!failed.select('Parent venue for Field A'));assert(!failed.button('Save venue'));
 } finally {await failed.close();}
});
test('unexpected save response is not treated as a confirmed association',async()=>{
 const t=await setup({override:call=>call.rpc==='set_location_venue'?{data:null,error:null}:undefined});try {
  await t.change(t.select('Parent venue for Field A'),'venue-a');await t.click(t.button('Save venue'));
  assert(t.text().includes('saved venue was not confirmed'));assert(!t.text().includes('Field A: venue saved'));
 } finally {await t.close();}
});
test('A→B→A scope navigation cannot accept the first A save or unlock a newer save',async()=>{
 const oldSave=deferred(),newSave=deferred();let writes=0;
 const t=await setup({override:call=>call.rpc==='set_location_venue'?(++writes===1?oldSave.promise:newSave.promise):undefined});try {
  await t.change(t.select('Parent venue for Field A'),'venue-a');await t.click(t.button('Save venue'));
  await t.render({scopeKey:'org-b'});await t.render({scopeKey:'org-a'});
  await t.change(t.select('Parent venue for Field A'),'venue-b');await t.click(t.button('Save venue'));
  await act(async()=>oldSave.resolve({data:'venue-a',error:null}));
  assert(t.button('Saving…').disabled);assert(!t.text().includes('Field A: venue saved'));assert.equal(t.select('Parent venue for Field A').value,'venue-b');
  await act(async()=>newSave.resolve({data:'venue-b',error:null}));assert(t.text().includes('Field A: venue saved'));
 } finally {await t.close();}
});
test('A→B→A navigation also rejects old venue edit completion',async()=>{
 const oldSave=deferred(),newSave=deferred();let writes=0;
 const t=await setup({superAdmin:true,override:call=>call.table==='venues'?(++writes===1?oldSave.promise:newSave.promise):undefined});try {
  await t.click(t.button('Venues'));await t.click(t.button('Edit venue'));
  await act(async()=>document.querySelector('form').dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true})));
  await t.render({scopeKey:'org-b'});await t.render({scopeKey:'org-a'});
  await t.click(t.button('Venues'));await t.click(t.button('Edit venue'));
  await act(async()=>document.querySelector('form').dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true})));
  await act(async()=>oldSave.resolve({data:{id:'venue-b'},error:null}));assert(t.button('Saving venue…').disabled);assert(!t.text().includes('Venue saved.'));
  await act(async()=>newSave.resolve({data:{id:'venue-b'},error:null}));assert(t.text().includes('Venue saved.'));
 } finally {await t.close();}
});
