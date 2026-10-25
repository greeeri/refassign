const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');
const React=require('react'),{createRoot}=require('react-dom/client'),{JSDOM}=require('jsdom'),{act}=React;
function load(file,deps={}){const module={exports:{}};vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{module,exports:module.exports,Error,TextDecoder,Blob,URL:deps.__url||URL,document:global.document,require:name=>deps[name]||require(name)});return module.exports;}
const helper=load('lib/locations/importExport.ts'),paging=load('lib/supabase/readAll.ts');
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve}};
const fields=[{id:'f1',name:'Field',address:'123',city:'City',state:'IA',active:true,field_complex:'Legacy',venue_id:'v1'}];
const raw=()=>[['id','name','address','city','state','active','field_complex','venue_id','venue_name','venue_action'],['f1','Field','123','City','IA','true','Legacy','v2','Other Park','set']];
async function setup({override,role='admin',props:initialProps={},memberships:initialMemberships,allFields=fields}={}){
 const dom=new JSDOM('<div id="root"></div>',{url:'https://example.test'});global.window=dom.window;global.document=dom.window.document;global.HTMLElement=dom.window.HTMLElement;global.IS_REACT_ACT_ENVIRONMENT=true;
 let currentRole=role,user='user-a',authCallback,importRaw=raw(),unsubscribed=false,owner=true;const calls=[];const downloads=[];let downloadBlob;window.HTMLAnchorElement.prototype.click=function(){downloads.push({filename:this.download,blob:downloadBlob})};let memberships=initialMemberships||{'org-a':fields.map(f=>({id:f.id})),'org-b':[]};
 const client={auth:{getUser:async()=>({data:{user:user?{id:user}:null},error:null}),onAuthStateChange:callback=>{authCallback=callback;return{data:{subscription:{unsubscribe(){unsubscribed=true}}}}}},from:table=>query({table,ops:[]}),rpc:(name,args)=>query({name,args,ops:[]})};
 function query(call){calls.push(call);const q={then(resolve,reject){return Promise.resolve().then(()=>{const custom=override?.(call);if(custom!==undefined)return custom;
  if(call.table==='profiles')return{data:{role:currentRole},error:null};
  if(call.table==='organization_memberships')return{data:{role:owner?'owner':'admin'},error:null};
  if(call.name==='is_super_admin')return{data:false,error:null};
  if(call.name==='get_organization_team')return owner?{data:{},error:null}:{data:null,error:{message:'Owner access revoked'}};
  if(call.table==='locations'&&call.ops.some(op=>op[0]==='update'||op[0]==='insert'))return{data:{id:call.ops.find(op=>op[0]==='eq')?.[2]||'new-id'},error:null};
  if(call.table==='locations'){const ids=call.ops.find(op=>op[0]==='in')?.[2]||[];const range=call.ops.find(op=>op[0]==='range');return{data:allFields.filter(field=>ids.includes(field.id)).slice(range?.[1]||0,(range?.[2]??999)+1),error:null};}
  if(call.name==='get_organization_locations'){const range=call.ops.find(op=>op[0]==='range');return{data:(memberships[call.args.p_organization_id]||[]).filter(field=>(call.ops.find(op=>op[0]==='in')?.[2]||[]).includes(field.id)).slice(range?.[1]||0,(range?.[2]??999)+1),error:null};}
  if(call.name==='get_location_venue_options')return{data:[{id:'v1',name:'Park'},{id:'v2',name:'Other Park'}],error:null};
  if(call.name==='set_location_venue')return{data:call.args.p_venue_id,error:null};
  return{data:[],error:null};}).then(resolve,reject)}};for(const method of ['select','eq','in','order','range','update','insert','single','maybeSingle'])q[method]=(...args)=>{call.ops.push([method,...args]);return q};return q;}
 const Component=load('components/LocationsRosterManager.tsx',{__url:{createObjectURL:blob=>{downloadBlob=blob;return'blob:test'},revokeObjectURL(){}},'../lib/supabase/client':{createClient:()=>client},'../lib/supabase/readAll':paging,'../lib/locations/importExport':helper,xlsx:{read:()=>({SheetNames:['Sheet1'],Sheets:{Sheet1:{}}}),utils:{sheet_to_json:()=>importRaw}}}).default;
 const root=createRoot(document.getElementById('root'));let props={organizationId:'org-a',accessScopeKey:'org-a:owner',canEdit:true,fieldIds:fields.map(field=>field.id),...initialProps};const render=async next=>{props={...props,...next};await act(async()=>root.render(React.createElement(Component,props)))};await render({});
 const button=text=>[...document.querySelectorAll('button')].find(el=>el.textContent===text);
 const click=async el=>{assert(el);await act(async()=>el.dispatchEvent(new window.MouseEvent('click',{bubbles:true})))};
 const upload=async(data=raw(),bytes=Promise.resolve(new ArrayBuffer(0)))=>{importRaw=data;const input=document.querySelector('input[type=file]');Object.defineProperty(input,'files',{configurable:true,value:[{name:'fields.csv',arrayBuffer:()=>bytes}]});await act(async()=>input.dispatchEvent(new window.Event('change',{bubbles:true})))};
 const close=async()=>{await act(async()=>root.unmount());dom.window.close()};
 return{calls,downloads,button,click,upload,close,render,setOwner:value=>{owner=value},setMemberships:value=>{memberships=value},text:()=>document.body.textContent,setRole:value=>{currentRole=value},auth:async value=>{user=value;await act(async()=>authCallback(value?'SIGNED_IN':'SIGNED_OUT',value?{user:{id:value}}:null))},unsubscribed:()=>unsubscribed};
}
test('uploader previews explicit venue action and saves IDs through RPC, with paged reads',async()=>{
 const t=await setup();try{
  assert(t.calls.filter(call=>call.table==='locations').every(call=>call.ops.some(op=>op[0]==='range')));
  assert(t.calls.find(call=>call.name==='get_location_venue_options').ops.some(op=>op[0]==='range'));
  await t.upload();assert(t.text().includes('Parent venue action'));assert(t.text().includes('Other Park'));assert(t.text().includes('set'));
  await t.click(t.button('Apply Location Changes'));const write=t.calls.find(call=>call.name==='set_location_venue');assert.deepEqual(JSON.parse(JSON.stringify(write.args)),{p_location_id:'f1',p_venue_id:'v2',p_expected_venue_id:'v1'});
  assert(t.text().includes('1 field metadata updates, 0 new fields, 1 venue associations'));assert(!t.button('Apply Location Changes'));
 }finally{await t.close()}
});
test('ambiguous or invalid IDs block the apply button and expose row error',async()=>{
 const t=await setup();try{const data=raw();data[1][0]='unknown';await t.upload(data);assert(t.button('Apply Location Changes').disabled);assert(t.text().includes('outside-workspace field ID'));assert(!t.calls.some(call=>call.name==='set_location_venue'));}finally{await t.close()}
});
test('denied parent association reports partial metadata progress and requires refresh before retry',async()=>{
 const t=await setup({override:call=>call.name==='set_location_venue'?{data:null,error:{message:'Parent changed'}}:undefined});try{
  await t.upload();await t.click(t.button('Apply Location Changes'));
  assert(t.text().includes('Metadata was saved, but venue association failed: Parent changed'));assert(t.text().includes('1 field metadata updates, 0 new fields, 0 venue associations'));assert(t.text().includes('not rolled back'));assert(!t.button('Apply Location Changes'));assert(t.button('Download Current Locations').disabled);
 }finally{await t.close()}
});
test('role is rechecked before applying and no writes occur after revocation',async()=>{
 const t=await setup();try{await t.upload();t.setRole('official');await t.click(t.button('Apply Location Changes'));assert(t.text().includes('Only authorized Administrators and Assignors'));assert(!t.calls.some(call=>call.ops.some(op=>op[0]==='update'||op[0]==='insert')));}finally{await t.close()}
});
test('sign-in change invalidates preview and late mutation response cannot restore prior user status',async()=>{
 const pending=deferred(),t=await setup({override:call=>call.name==='set_location_venue'?pending.promise:undefined});try{
  await t.upload();await t.click(t.button('Apply Location Changes'));await t.auth('user-b');await act(async()=>pending.resolve({data:'v2',error:null}));
  assert(t.text().includes('Sign-in changed'));assert(!t.text().includes('Locations import complete'));assert(!t.button('Apply Location Changes'));assert(t.button('Download Current Locations').disabled);
 }finally{await t.close()}
});
test('unmount stops remaining import work after in-flight metadata completes',async()=>{
 const pending=deferred(),t=await setup({override:call=>call.table==='locations'&&call.ops.some(op=>op[0]==='update')?pending.promise:undefined});
 await t.upload();await t.click(t.button('Apply Location Changes'));await t.close();await act(async()=>pending.resolve({data:{id:'f1'},error:null}));
 assert(t.unsubscribed());assert(!t.calls.some(call=>call.name==='set_location_venue'));
});
test('a stale file read cannot restore a preview after refresh',async()=>{
 const pending=deferred(),t=await setup();try{await t.upload(raw(),pending.promise);await t.click(t.button('Refresh locations and venues'));await act(async()=>pending.resolve(new ArrayBuffer(0)));assert(!t.button('Apply Location Changes'));}finally{await t.close()}
});
test('unauthorized role receives no field or venue directory reads',async()=>{
 const t=await setup({role:'official'});try{assert(t.button('Download Current Locations').disabled);assert(!t.calls.some(call=>call.table==='locations'||call.name==='get_location_venue_options'));}finally{await t.close()}
});
test('venue ID download is available only after authorized catalog load',async()=>{
 const t=await setup();try{assert.equal(t.button('Download Venue IDs').disabled,false);await t.auth(null);assert.equal(t.button('Download Venue IDs').disabled,true);}finally{await t.close()}
 const denied=await setup({role:'official'});try{assert(denied.button('Download Venue IDs').disabled);}finally{await denied.close()}
});
test('auth change during post-import refresh cannot display stale success in the new context',async()=>{
 const pending=deferred();let fieldReads=0;
 const t=await setup({override:call=>{if(call.table==='locations'&&!call.ops.some(op=>op[0]==='update'||op[0]==='insert')&&++fieldReads===2)return pending.promise}});try{
  await t.upload();await t.click(t.button('Apply Location Changes'));assert.equal(fieldReads,2);
  await t.auth('user-b');await act(async()=>pending.resolve({data:fields,error:null}));
  assert(t.text().includes('Sign-in changed'));assert(!t.text().includes('Locations import complete'));assert(!t.text().includes('Confirmed:'));assert(t.button('Download Venue IDs').disabled);
 }finally{await t.close()}
});
const writes=t=>t.calls.filter(call=>call.name==='set_location_venue'||call.ops.some(op=>op[0]==='update'||op[0]==='insert'));
test('multi-organization owner exports exactly current workspace IDs, not other-org or unlinked RLS-visible fields',async()=>{
 const foreign={...fields[0],id:'test-only',name:'Test Only'},unlinked={...fields[0],id:'unlinked',name:'Unlinked'};
 const t=await setup({allFields:[...fields,foreign,unlinked],memberships:{'org-a':[{id:'f1'}],'org-b':[{id:'test-only'}]}});try{
  await t.click(t.button('Download Current Locations'));
  const csv=helper.parseLocationCSV(await t.downloads[0].blob.text());assert.equal(csv.length,2);assert.equal(csv[1][0],'f1');
  const reads=t.calls.filter(call=>call.table==='locations');assert(reads.every(call=>JSON.stringify(call.ops.find(op=>op[0]==='in')?.[2])==='["f1"]'));
  const data=raw();data[1][0]='test-only';data[1][1]='Test Only';await t.upload(data);assert(t.button('Apply Location Changes').disabled);assert(t.text().includes('outside-workspace'));assert.equal(writes(t).length,0);
  await t.render({organizationId:'org-b',accessScopeKey:'org-b:owner',fieldIds:['test-only']});await t.click(t.button('Download Current Locations'));
  const other=helper.parseLocationCSV(await t.downloads[1].blob.text());assert.equal(other.length,2);assert.equal(other[1][0],'test-only');
 }finally{await t.close()}
});
test('empty field scope never queries global locations and exports headers only; missing org fails closed',async()=>{
 const t=await setup({props:{fieldIds:[]}});try{assert(!t.calls.some(call=>call.table==='locations'));assert(!t.calls.some(call=>call.name==='get_organization_locations'));await t.click(t.button('Download Current Locations'));assert.equal(helper.parseLocationCSV(await t.downloads[0].blob.text()).length,1);await t.upload();assert(t.button('Apply Location Changes').disabled);assert.equal(writes(t).length,0);}finally{await t.close()}
 const missing=await setup({props:{organizationId:undefined}});try{assert(missing.button('Download Current Locations').disabled);assert.equal(missing.calls.length,0);}finally{await missing.close()}
});
test('more than 1000 workspace fields are bounded into deterministic chunks with none dropped from export',async()=>{
 const many=Array.from({length:1005},(_,i)=>({...fields[0],id:`f-${String(i).padStart(4,'0')}`,name:`Field ${i}`}));
 const t=await setup({allFields:many,props:{fieldIds:many.map(f=>f.id)},memberships:{'org-a':many.map(f=>({id:f.id}))}});try{
  await t.click(t.button('Download Current Locations'));const exported=helper.parseLocationCSV(await t.downloads[0].blob.text());assert.equal(exported.length,1006);assert.equal(new Set(exported.slice(1).map(row=>row[0])).size,1005);
  for(const name of ['locations','get_organization_locations']){const reads=t.calls.filter(call=>call.table===name||call.name===name);assert.equal(reads.length,6);assert(reads.every(call=>call.ops.find(op=>op[0]==='in')[2].length<=200&&call.ops.some(op=>op[0]==='range')));}
 }finally{await t.close()}
});
test('batch-wide fresh membership preflight rejects any removed field before even the first metadata write',async()=>{
 const second={...fields[0],id:'f2',name:'Second'};const t=await setup({allFields:[...fields,second],props:{fieldIds:['f1','f2']},memberships:{'org-a':[{id:'f1'},{id:'f2'}]}});try{
  const data=raw();data.push(['f2','Second','123','City','IA','true','','','','preserve']);await t.upload(data);
  t.setMemberships({'org-a':[{id:'f1'}]});await t.click(t.button('Apply Location Changes'));assert(t.text().includes('no longer in this workspace'));assert.equal(writes(t).length,0);
 }finally{await t.close()}
});
test('workspace membership is freshly checked again before parent write after metadata',async()=>{
 let updated=false;const t=await setup({override:call=>{if(call.table==='locations'&&call.ops.some(op=>op[0]==='update'))updated=true;if(call.name==='get_organization_locations'&&updated)return{data:[],error:null}}});try{
  await t.upload();await t.click(t.button('Apply Location Changes'));assert.equal(writes(t).length,1);assert(!t.calls.some(call=>call.name==='set_location_venue'));assert(t.text().includes('1 field metadata updates'));assert(t.text().includes('no longer in this workspace'));
 }finally{await t.close()}
});
test('revoked current-org ownership is rejected even when global role and other-org access remain',async()=>{
 const t=await setup();try{await t.upload();t.setOwner(false);await t.click(t.button('Apply Location Changes'));assert(t.text().includes('Current workspace owner access is required'));assert.equal(writes(t).length,0);assert(t.calls.filter(call=>call.name==='get_organization_team').every(call=>call.args.p_organization_id==='org-a'));}finally{await t.close()}
});
test('same-user scope change invalidates preview and revoked canEdit stops import controls',async()=>{
 const t=await setup();try{await t.upload();await t.render({accessScopeKey:'org-a:new-grants',canEdit:false});assert(t.button('Download Current Locations').disabled);assert(!t.button('Apply Location Changes'));assert.equal(writes(t).length,0);}finally{await t.close()}
});
test('A-B-A pending import cannot resume its parent write or unlock a newer import',async()=>{
 const first=deferred(),second=deferred();let updateCount=0;
 const t=await setup({override:call=>{if(call.table==='locations'&&call.ops.some(op=>op[0]==='update'))return ++updateCount===1?first.promise:second.promise}});try{
  await t.upload();await t.click(t.button('Apply Location Changes'));
  await t.render({organizationId:'org-b',accessScopeKey:'org-b:owner'});await t.render({organizationId:'org-a',accessScopeKey:'org-a:owner'});
  await t.upload();await t.click(t.button('Apply Location Changes'));assert.equal(updateCount,2);
  await act(async()=>first.resolve({data:{id:'f1'},error:null}));assert(t.button('Updating Locations…').disabled);assert(!t.calls.some(call=>call.name==='set_location_venue'));assert(!t.text().includes('Locations import complete'));
  await act(async()=>second.resolve({data:{id:'f1'},error:null}));assert.equal(t.calls.filter(call=>call.name==='set_location_venue').length,1);
 }finally{await t.close()}
});
test('auth invalidation of a pending import recovers via refresh without old completion clearing a newer preview',async()=>{
 const pending=deferred();const t=await setup({override:call=>call.table==='locations'&&call.ops.some(op=>op[0]==='update')?pending.promise:undefined});try{
  await t.upload();await t.click(t.button('Apply Location Changes'));await t.auth('user-b');await t.click(t.button('Refresh locations and venues'));assert.equal(t.button('Download Current Locations').disabled,false);
  await t.upload();await act(async()=>pending.resolve({data:{id:'f1'},error:null}));assert(t.button('Apply Location Changes'));assert(!t.calls.some(call=>call.name==='set_location_venue'));
 }finally{await t.close()}
});
test('new-field uploads are rejected in the workspace with Add/Connect guidance and no insert',async()=>{
 const t=await setup();try{const data=raw();data[1][0]='';data[1][1]='New Field';data[1][7]='';data[1][9]='preserve';await t.upload(data);assert(t.text().includes('Add or connect new fields in Locations first'));assert(t.button('Apply Location Changes').disabled);assert.equal(writes(t).length,0);}finally{await t.close()}
});
test('GameSetup passes organization, current scope, editing permission and exact displayed field IDs',()=>{
 const source=fs.readFileSync('components/GameSetup.tsx','utf8');assert(source.includes('<LocationsRosterManager organizationId={organizationId} accessScopeKey={accessScopeKey} canEdit={canEditDirectory()} fieldIds={locations.map(location => location.id)} />'));
});
