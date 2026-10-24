const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');
const React=require('react'),{createRoot}=require('react-dom/client'),{JSDOM}=require('jsdom'),{act}=React;
function load(file,deps={}){const module={exports:{}};vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{module,exports:module.exports,Error,TextDecoder,Blob,URL,document:global.document,require:name=>deps[name]||require(name)});return module.exports;}
const helper=load('lib/locations/importExport.ts'),paging=load('lib/supabase/readAll.ts');
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve}};
const fields=[{id:'f1',name:'Field',address:'123',city:'City',state:'IA',active:true,field_complex:'Legacy',venue_id:'v1'}];
const raw=()=>[['id','name','address','city','state','active','field_complex','venue_id','venue_name','venue_action'],['f1','Field','123','City','IA','true','Legacy','v2','Other Park','set']];
async function setup({override,role='admin'}={}){
 const dom=new JSDOM('<div id="root"></div>',{url:'https://example.test'});global.window=dom.window;global.document=dom.window.document;global.HTMLElement=dom.window.HTMLElement;global.IS_REACT_ACT_ENVIRONMENT=true;
 let currentRole=role,user='user-a',authCallback,importRaw=raw(),unsubscribed=false;const calls=[];
 const client={auth:{getUser:async()=>({data:{user:user?{id:user}:null},error:null}),onAuthStateChange:callback=>{authCallback=callback;return{data:{subscription:{unsubscribe(){unsubscribed=true}}}}}},from:table=>query({table,ops:[]}),rpc:(name,args)=>query({name,args,ops:[]})};
 function query(call){calls.push(call);const q={then(resolve,reject){return Promise.resolve().then(()=>{const custom=override?.(call);if(custom!==undefined)return custom;
  if(call.table==='profiles')return{data:{role:currentRole},error:null};
  if(call.table==='locations'&&call.ops.some(op=>op[0]==='update'||op[0]==='insert'))return{data:{id:'f1'},error:null};
  if(call.table==='locations')return{data:fields,error:null};
  if(call.name==='get_location_venue_options')return{data:[{id:'v1',name:'Park'},{id:'v2',name:'Other Park'}],error:null};
  if(call.name==='set_location_venue')return{data:call.args.p_venue_id,error:null};
  return{data:[],error:null};}).then(resolve,reject)}};for(const method of ['select','eq','order','range','update','insert','single','maybeSingle'])q[method]=(...args)=>{call.ops.push([method,...args]);return q};return q;}
 const Component=load('components/LocationsRosterManager.tsx',{'../lib/supabase/client':{createClient:()=>client},'../lib/supabase/readAll':paging,'../lib/locations/importExport':helper,xlsx:{read:()=>({SheetNames:['Sheet1'],Sheets:{Sheet1:{}}}),utils:{sheet_to_json:()=>importRaw}}}).default;
 const root=createRoot(document.getElementById('root'));await act(async()=>root.render(React.createElement(Component)));
 const button=text=>[...document.querySelectorAll('button')].find(el=>el.textContent===text);
 const click=async el=>{assert(el);await act(async()=>el.dispatchEvent(new window.MouseEvent('click',{bubbles:true})))};
 const upload=async(data=raw(),bytes=Promise.resolve(new ArrayBuffer(0)))=>{importRaw=data;const input=document.querySelector('input[type=file]');Object.defineProperty(input,'files',{configurable:true,value:[{name:'fields.csv',arrayBuffer:()=>bytes}]});await act(async()=>input.dispatchEvent(new window.Event('change',{bubbles:true})))};
 const close=async()=>{await act(async()=>root.unmount());dom.window.close()};
 return{calls,button,click,upload,close,text:()=>document.body.textContent,setRole:value=>{currentRole=value},auth:async value=>{user=value;await act(async()=>authCallback(value?'SIGNED_IN':'SIGNED_OUT',value?{user:{id:value}}:null))},unsubscribed:()=>unsubscribed};
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
 const t=await setup();try{const data=raw();data[1][0]='unknown';await t.upload(data);assert(t.button('Apply Location Changes').disabled);assert(t.text().includes('Unknown or inaccessible field ID'));assert(!t.calls.some(call=>call.name==='set_location_venue'));}finally{await t.close()}
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
