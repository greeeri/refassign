const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const compile = source => ts.transpileModule(source, {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
function load(file, deps={}) { const module={exports:{}}; vm.runInNewContext(compile(fs.readFileSync(file,'utf8')), {module,exports:module.exports,Set,Map,Promise,require:name=>deps[name]||require(name)}); return module.exports; }
const helpers=load('lib/assignments/personalRoster.ts', {'../supabase/readAll':{}});
const exact=(id,in_roster=false)=>({official_id:id,display_name:id,email_hint:'a***@example.test',in_roster,match_exact:true});
const copy=x=>JSON.parse(JSON.stringify(x));
test('preview selects unique exact matches only and deduplicates IDs, never fuzzy names',()=>{
 const seen=new Set();
 assert.equal(helpers.chooseRosterImportMatch('A',[exact('a')],seen).status,'match');
 assert.equal(helpers.chooseRosterImportMatch('same',[exact('a')],seen).status,'duplicate');
 assert.equal(helpers.chooseRosterImportMatch('B',[exact('b',true)],seen).status,'already added');
 assert.equal(helpers.chooseRosterImportMatch('A',[exact('c'),exact('d')],seen).status,'ambiguous');
 assert.equal(helpers.chooseRosterImportMatch('A',[{...exact('e'),match_exact:false}],seen).status,'ambiguous');
 assert.equal(helpers.chooseRosterImportMatch('X',[],seen).status,'not found');
});
function nodes(node) { if(Array.isArray(node))return node.flatMap(nodes); if(!node||typeof node!=='object')return [];return [node,...nodes(node.props?.children)]; }
function text(node) {if(Array.isArray(node))return node.map(text).join(''); if(node==null||typeof node==='boolean')return '';return typeof node==='object'?text(node.props?.children):String(node);}
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function setup({owner=false,prepared=true,canManage=true,rpcOverride}={}) {
 const cells=[],effects=[],calls=[];let cursor=0,tree,changes=0;
 const react={useState(init){let i=cursor++;if(!(i in cells))cells[i]=typeof init==='function'?init():init;return [cells[i],value=>cells[i]=typeof value==='function'?value(cells[i]):value];},useRef(init){let i=cursor++;if(!(i in cells))cells[i]={current:init};return cells[i];},useMemo(fn){cursor++;return fn();},useEffect(fn,deps){let i=cursor++,prev=cells[i];if(!prev||deps.some((v,j)=>v!==prev[j])){cells[i]=deps;effects.push(fn);}}};
 const client={rpc:async(name,args)=>{calls.push({name,args});if(rpcOverride){const overridden=rpcOverride(name,args);if(overridden)return overridden;}
 if(name==='list_personal_roster_assignors')return {data:[{user_id:'manager',display_name:'Manager'},{user_id:'other',display_name:'Other'}],error:null};
 if(name==='search_personal_roster_officials')return {data:args.p_query==='missing'?[]:[exact(args.p_query,args.p_query==='existing')],error:null};return {data:null,error:null};}};
 const component=load('components/PersonalOfficialRoster.tsx', {'react':react,'../lib/supabase/client':{createClient:()=>client},'../lib/assignments/personalRoster':helpers,'xlsx':{read:()=>({SheetNames:['Sheet'],Sheets:{Sheet:{}}}),utils:{sheet_to_json:()=>[['Email','Name'],['a@example.test','A'],['a@example.test','A'],['missing','None']]}}}).default;
 const props={organizationId:'org',state:{prepared,enabled:false,owner_wide:owner,can_manage:canManage},onChanged:()=>changes++};
 const render=()=>{cursor=0;tree=component(props);while(effects.length)effects.shift()();return tree;};
 const settle=async()=>{await tick();render();await tick();render();};
 const all=()=>nodes(tree),button=label=>all().find(n=>n.type==='button'&&text(n)===label),input=()=>all().find(n=>n.type==='input'&&n.props.placeholder==='Search existing officials'),target=()=>all().find(n=>n.type==='select'&&nodes(n).some(o=>o.type==='option'&&text(o)==='Choose an assignor'));
 render();return {render,settle,all,button,input,target,calls,props,text:()=>text(tree),changes:()=>changes};
}
test('scoped user adds/removes only their personal roster and preserves history',async()=>{
 const t=setup();await t.settle();t.button('Add / remove officials').props.onClick();t.render();
 t.input().props.onChange({target:{value:'Ada'}});t.render();await t.all().find(n=>n.type==='form').props.onSubmit({preventDefault(){}});await t.settle();
 t.button('Add to roster').props.onClick();await t.settle();assert.equal(t.changes(),1);
 assert.deepEqual(copy(t.calls.find(c=>c.name==='set_personal_roster_official').args),{p_organization_id:'org',p_official_id:'Ada',p_active:true});
 t.button('Remove from roster').props.onClick();await t.settle();assert(t.text().includes('Assignments and history were not changed'));
 assert(!t.calls.some(c=>/invitation|eligibility|organization_official/.test(c.name)));
});
test('owner must select assignor; CSV maps, previews duplicates and commits reviewed IDs only',async()=>{
 const t=setup({owner:true});await t.settle();t.button('Add / remove officials').props.onClick();t.render();assert(t.button('Search').props.disabled);
 t.target().props.onChange({target:{value:'manager'}});await t.settle();
 t.all().find(n=>n.type==='input'&&n.props.type==='file').props.onChange({target:{files:[{name:'roster.csv',size:100,text:async()=>''}]}});await t.settle();
 t.button('Preview matches').props.onClick();await t.settle();assert(t.text().includes('duplicate'));assert(t.text().includes('not found'));assert(t.text().includes('1 new matches ready'));
 t.button('Add reviewed matches').props.onClick();await t.settle();
 assert.deepEqual(copy(t.calls.find(c=>c.name==='set_personal_roster_officials').args),{p_organization_id:'org',p_assignor_id:'manager',p_official_ids:['a@example.test']});
 assert(t.text().includes('Your owner-wide pool stays unchanged'));assert(t.text().includes('No profiles, invitations, eligibility or assignments were changed'));
});
test('target switch clears preview, rejected writes preserve rows and report errors',async()=>{
 const t=setup({owner:true,rpcOverride:(name)=>name==='set_personal_roster_official'?Promise.resolve({data:null,error:{message:'Scope changed'}}):null});await t.settle();
 t.button('Add / remove officials').props.onClick();t.render();t.target().props.onChange({target:{value:'manager'}});await t.settle();
 t.input().props.onChange({target:{value:'Ada'}});t.render();t.all().find(n=>n.type==='form').props.onSubmit({preventDefault(){}});await t.settle();
 t.button('Add to roster').props.onClick();await t.settle();assert(t.text().includes('Scope changed'));assert.equal(t.changes(),0);
 t.target().props.onChange({target:{value:'other'}});await t.settle();assert(!t.button('Add to roster'));
});
test('unprepared or nonmanager contexts expose no roster mutations',async()=>{
 const t=setup();t.props.state.prepared=false;t.render();assert.equal(t.all().length,0);
 t.props.state.prepared=true;t.props.state.can_manage=false;t.render();assert.equal(t.all().length,0);
});

test('switching organization or losing owner-wide access clears imported draft and target',async()=>{
 const t=setup({owner:true});await t.settle();t.button('Add / remove officials').props.onClick();t.render();t.target().props.onChange({target:{value:'manager'}});await t.settle();
 t.all().find(n=>n.type==='input'&&n.props.type==='file').props.onChange({target:{files:[{name:'roster.csv',size:100,text:async()=>''}]}});await t.settle();assert(t.button('Preview matches'));
 t.props.organizationId='new-org';t.render();await t.settle();assert(t.button('Add / remove officials'));t.button('Add / remove officials').props.onClick();t.render();assert.equal(t.target().props.value,'');assert(!t.button('Preview matches'));
 t.props.state.owner_wide=false;t.render();await t.settle();assert(!t.target());
});

test('only an unprepared owner manager sees prepare, with inactive enforcement and unchanged pool explanation',async()=>{
 for(const options of [{owner:false,prepared:false},{owner:true,prepared:false,canManage:false},{owner:true,prepared:true}]) {
  const t=setup(options);await t.settle();assert(!t.button('Prepare roster tools'));
 }
 const t=setup({owner:true,prepared:false});await t.settle();assert(t.button('Prepare roster tools'));
 assert(t.text().includes('does not activate personal-roster enforcement'));assert(t.text().includes('owner-wide pool stays unchanged'));
 assert.equal(t.calls.length,0);assert(!t.button('Add / remove officials'));
 const click=t.button('Prepare roster tools').props.onClick;click();click();await t.settle();
 assert.equal(t.calls.length,1);assert.deepEqual(copy(t.calls[0]),{name:'prepare_personal_rosters',args:{p_organization_id:'org'}});assert.equal(t.changes(),1);
 assert(t.text().includes('Enforcement is still inactive'));assert(!t.calls.some(c=>c.name.includes('activate')));
 t.props.state.prepared=true;t.render();await t.settle();assert(t.button('Add / remove officials'));assert(!t.button('Prepare roster tools'));
});
test('prepare is busy while pending and RPC failures allow an explicit retry without refresh',async()=>{
 let resolve;let attempt=0;
 const t=setup({owner:true,prepared:false,rpcOverride:name=>name==='prepare_personal_rosters'?(++attempt===1?new Promise(r=>resolve=r):Promise.reject(new Error('Network failed'))):null});await t.settle();
 t.button('Prepare roster tools').props.onClick();t.render();assert(t.button('Preparing…').props.disabled);
 resolve({error:{message:'Owner verification failed'}});await t.settle();assert(t.text().includes('Owner verification failed'));assert.equal(t.changes(),0);
 t.button('Prepare roster tools').props.onClick();await t.settle();assert(t.text().includes('Could not prepare roster tools'));assert(t.button('Prepare roster tools'));assert.equal(t.changes(),0);
});
test('late prepare responses cannot refresh a newer organization or revoked owner/manager context',async()=>{
 for(const update of [t=>t.props.organizationId='other-org',t=>t.props.state.owner_wide=false,t=>t.props.state.can_manage=false]) {
  let resolve;const t=setup({owner:true,prepared:false,rpcOverride:name=>name==='prepare_personal_rosters'?new Promise(r=>resolve=r):null});await t.settle();
  t.button('Prepare roster tools').props.onClick();t.render();update(t);t.render();await t.settle();resolve({error:null});await t.settle();
  assert.equal(t.changes(),0);assert(!t.text().includes('Roster tools prepared.'));
 }
});
