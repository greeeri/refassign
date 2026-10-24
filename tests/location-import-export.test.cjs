const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');
function load(file,deps={}){const module={exports:{}};vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{module,exports:module.exports,Error,require:name=>deps[name]||require(name)});return module.exports;}
const api=load('lib/locations/importExport.ts');
const plain=value=>JSON.parse(JSON.stringify(value));
const fields=[{id:'f1',name:'Field, One',address:'123 Park',city:'City',state:'IA',field_complex:'Legacy',active:true,venue_id:'v1'},{id:'f2',name:'Field Two',address:null,city:null,state:null,field_complex:null,active:true,venue_id:null}];
const venues=[{id:'v1',name:'Park'},{id:'v2',name:'Other Park'}];
const header=['id','name','address','city','state','active','field_complex','venue_id','venue_name','venue_action'];
const row=(changes={})=>{const x={id:'f1',name:'Field, One',address:'123 Park',city:'City',state:'IA',active:'true',field_complex:'Legacy',venue_id:'',venue_name:'',venue_action:'',...changes};return header.map(h=>x[h]);};
const validate=(changes={},locations=fields)=>api.validateLocationImport([header,row(changes)],locations,venues)[0];
function client(override){const calls=[];return {calls,from(table){const call={table,ops:[]};calls.push(call);const q={then(resolve,reject){return Promise.resolve(override?.(call)||{data:{id:call.ops.find(op=>op[0]==='eq')?.[2]||'new-id'},error:null}).then(resolve,reject)}};for(const op of ['update','insert','eq','select','single'])q[op]=(...args)=>{call.ops.push([op,...args]);return q};return q},rpc(name,args){const call={name,args};calls.push(call);return Promise.resolve(override?.(call)||{data:args.p_venue_id,error:null})}};}

test('export roundtrip preserves stable field/venue IDs, escaped labels and explicit preserve intent',()=>{
 const text=api.exportLocationsCSV(fields,venues),raw=api.parseLocationCSV(text),rows=api.validateLocationImport(raw,fields,venues);
 assert(text.startsWith('id,name,address,city,state,active,field_complex,venue_id,venue_name,venue_action'));
 assert.equal(rows.length,2);assert(rows.every(row=>row.valid&&row.venue_action==='preserve'));
 assert.equal(rows[0].id,'f1');assert.equal(rows[0].venue_id,'v1');assert.equal(rows[0].name,'Field, One');assert.equal(rows[0].venue_name,'Park');
});
test('legacy files and blank parent columns preserve existing mappings',()=>{
 const legacy=api.validateLocationImport([['name','address','city','state','active'],['Field, One','123 Park','City','IA','true']],fields,venues)[0];
 assert(legacy.valid);assert.equal(legacy.id,'f1');assert.equal(legacy.venue_action,'preserve');assert.equal(legacy.expected_venue_id,'v1');
 assert(validate().valid);assert.equal(validate().venue_action,'preserve');
});
test('association changes require known explicit field and venue IDs, never a guessed name match',()=>{
 const set=validate({venue_id:'v2',venue_action:'set'});assert(set.valid);assert.equal(set.expected_venue_id,'v1');
 assert.equal(validate({venue_id:'v2'}).venue_action,'set');
 for(const changes of [{id:'missing'},{id:'',venue_id:'v2',venue_action:'set'},{id:'',name:'New',venue_id:'v2',venue_action:'set'},{venue_id:'missing',venue_name:'Park',venue_action:'set'},{venue_id:'',venue_name:'Park',venue_action:'set'},{venue_id:'v2',venue_action:'preserve'}])assert.equal(validate(changes).valid,false,JSON.stringify(changes));
 const infoOnly=validate({venue_name:'Unrelated label'});assert(infoOnly.valid);assert.equal(infoOnly.venue_action,'preserve');
});
test('explicit clear requires blank parent ID, blank alone never clears',()=>{
 const clear=validate({venue_action:'clear'});assert(clear.valid);assert.equal(clear.venue_action,'clear');
 assert.equal(validate({venue_action:'clear',venue_id:'v1'}).valid,false);
 assert.equal(validate({venue_action:'erase'}).valid,false);
});
test('ambiguous legacy names and duplicate targets are rejected before mutation',()=>{
 assert.equal(validate({id:''},[...fields,{...fields[0],id:'duplicate'}]).valid,false);
 const duplicates=api.validateLocationImport([header,row(),row({id:'',name:'Field, One'})],fields,venues);assert(duplicates.every(row=>!row.valid));
 assert.throws(()=>api.validateLocationImport([['name','name']],fields,venues),/Duplicate/);
 assert.throws(()=>api.parseLocationCSV('"unterminated'),/Unclosed/);
});
test('apply uses explicit parent RPC with expected prior UUID; metadata never includes parent ID',async()=>{
 const c=client(),r=await api.applyLocationImport(c,[validate({venue_action:'set',venue_id:'v2'})],async()=>{});
 assert.deepEqual(plain(r),{added:0,updated:1,associations:1,error:null,stopped:false});
 assert(!('venue_id' in c.calls[0].ops.find(op=>op[0]==='update')[1]));
 assert.deepEqual(plain(c.calls[1]),{name:'set_location_venue',args:{p_location_id:'f1',p_venue_id:'v2',p_expected_venue_id:'v1'}});
});
test('preserve performs no parent write; explicit clear sends null with expected UUID',async()=>{
 const c=client();await api.applyLocationImport(c,[validate()],async()=>{});assert.equal(c.calls.length,1);
 const clear=client();await api.applyLocationImport(clear,[validate({venue_action:'clear'})],async()=>{});assert.equal(clear.calls[1].args.p_venue_id,null);assert.equal(clear.calls[1].args.p_expected_venue_id,'v1');
});
test('unknown or zero-row metadata results never count as successful updates',async()=>{
 const c=client(()=>({data:null,error:null})),r=await api.applyLocationImport(c,[validate({venue_action:'set',venue_id:'v2'})],async()=>{});
 assert.equal(r.updated,0);assert.equal(r.associations,0);assert.match(r.error,/not confirmed/);assert.equal(c.calls.length,1);
 const invalid=client();assert((await api.applyLocationImport(invalid,[validate({id:'bad'})],async()=>{})).error);assert.equal(invalid.calls.length,0);
});
test('denied/stale parent RPC reports committed metadata and stops later rows honestly',async()=>{
 const c=client(call=>call.name?{data:null,error:{message:'Parent changed or permission denied'}}:undefined);
 const r=await api.applyLocationImport(c,[validate({venue_action:'set',venue_id:'v2'}),validate({id:'f2',name:'Field Two'})],async()=>{});
 assert.equal(r.updated,1);assert.equal(r.associations,0);assert.match(r.error,/Metadata was saved, but venue association failed/);assert.equal(c.calls.length,2);
});
test('partial imports count confirmed additions and stop on a later metadata failure',async()=>{
 const c=client(call=>call.ops?.some(op=>op[0]==='eq'&&op[2]==='f1')?{data:null,error:{message:'Denied'}}:undefined);
 const r=await api.applyLocationImport(c,[validate({id:'',name:'New Field'}),validate()],async()=>{});
 assert.equal(r.added,1);assert.equal(r.updated,0);assert.match(r.error,/Denied/);
});
test('authorization is rechecked before mutations and revoked access never writes',async()=>{
 const c=client();let checks=0;
 const r=await api.applyLocationImport(c,[validate({venue_action:'set',venue_id:'v2'})],async()=>{if(++checks===2)throw new Error('Role revoked')});
 assert.equal(checks,2);assert.equal(c.calls.length,1);assert.equal(r.updated,1);assert.match(r.error,/Role revoked/);
 const denied=client();await api.applyLocationImport(denied,[validate()],async()=>{throw new Error('User changed')});assert.equal(denied.calls.length,0);
});
test('unmount/scope invalidation stops before subsequent writes and never retries an uncertain parent result',async()=>{
 const c=client();let current=true;
 const r=await api.applyLocationImport(c,[validate()],async()=>{current=false},()=>current);assert(r.stopped);assert.equal(c.calls.length,0);
 const ambiguous=client(call=>call.name?{data:'unexpected-parent',error:null}:undefined);
 const result=await api.applyLocationImport(ambiguous,[validate({venue_action:'set',venue_id:'v2'})],async()=>{});
 assert.equal(result.associations,0);assert.match(result.error,/not confirmed/);assert.equal(ambiguous.calls.length,2);
});
test('venue catalog export includes authorized IDs and escapes names without creating associations',()=>{
 const csv=api.exportVenueCatalogCSV([{id:'unlinked-venue',name:'Park, "North"'}]);
 assert.deepEqual(plain(api.parseLocationCSV(csv)),[['venue_id','venue_name'],['unlinked-venue','Park, "North"']]);
});
