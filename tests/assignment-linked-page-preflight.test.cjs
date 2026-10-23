const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const vm = require('node:vm');
const { applyScopeFilter } = require('./support/scope-query.cjs');
const copy = value => JSON.parse(JSON.stringify(value));
const compile = source => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
function moduleFrom(file) { const module = {exports:{}}; vm.runInNewContext(compile(fs.readFileSync(file,'utf8')), {module,exports:module.exports,require}); return module.exports; }
const paging = moduleFrom('lib/supabase/readAll.ts');
const scope = moduleFrom('components/leagueGameScope.ts');
const source = fs.readFileSync('components/AssignmentsManagerV2.tsx', 'utf8');
const ast = ts.createSourceFile('component.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let node; function visit(item) { if(ts.isFunctionDeclaration(item) && item.name?.text === 'assignLinkedOfficial') node=item; ts.forEachChild(item,visit); } visit(ast);
assert(node);
function fixture({ eligible=['a','b'], allowB=true, accept=true, group=true, canManage=true, failTable=null }={}) {
  const calls=[], sent=[], confirms=[];
  const tables={
    game_link_members: group ? [{group_id:'group',game_id:'visible'},{group_id:'group',game_id:'hidden'}] : [],
    games:[{id:'visible',organization_id:'org',league_id:'a',location_id:'north'},{id:'hidden',organization_id:'org',league_id:'b',location_id:'south'}],
    official_league_eligibility:eligible.map(league_id=>({official_id:'ref',league_id})),
  };
  const state={...paging,...scope,organizationId:'org',canManage,fullLeagueAccess:false,
    allowedGameAccess:[{league_id:'a',all_locations:false,location_ids:['north']},...(allowB?[{league_id:'b',all_locations:false,location_ids:['south']}]:[])],
    games:[tables.games[0]],reviewedLinkedAssignments:{current:new Set()},window:{confirm(message){confirms.push(message);return accept;}}};
  state.supabase={ from(table) {
    const call={table,operations:[]};calls.push(call);
    const query={then(resolve,reject){
      if(failTable===table)return Promise.resolve({data:null,error:{message:'query failed'}}).then(resolve,reject);
      let rows=[...tables[table]];
      for(const [method,key,value] of call.operations){
        if(method==='eq')rows=rows.filter(row=>row[key]===value);
        if(method==='in')rows=rows.filter(row=>value.includes(row[key]));
        if(method==='or')rows=rows.filter(row=>applyScopeFilter(row,key.replaceAll('"',''),value));
        if(method==='range')rows=rows.slice(key,value+1);
      }
      return Promise.resolve({data:rows,error:null}).then(resolve,reject);
    }};
    for(const method of ['select','eq','in','or','order','range'])query[method]=(...args)=>{call.operations.push([method,...copy(args)]);return query;};
    return query;
  },rpc:async(name,args)=>{sent.push({name,args:copy(args)});return {data:group?2:1,error:null};}};
  vm.runInNewContext(compile(node.getText(ast)),state);
  return {calls,sent,confirms,state,run:()=>state.assignLinkedOfficial({p_game_id:'visible',p_position_id:'position',p_official_id:'ref'})};
}
test('linked assignment denies wrong-league official for an off-page member before any mutation',async()=>{
  const f=fixture({eligible:['a']});const result=await f.run();
  assert.match(result.error.message,/not league-eligible/);assert.equal(f.sent.length,0);assert.equal(f.confirms.length,0);
});
test('linked assignment rechecks every group game through organization and location scope',async()=>{
  const f=fixture({allowB:false});const result=await f.run();
  assert.match(result.error.message,/Every linked game/);assert.equal(f.sent.length,0);
  const read=f.calls.find(call=>call.table==='games');
  assert(read.operations.findIndex(([op])=>op==='or')<read.operations.findIndex(([op])=>op==='range'));
  assert(read.operations.some(([op,key,value])=>op==='eq'&&key==='organization_id'&&value==='org'));
});
test('eligible off-page group explicitly discloses partial candidate warnings and keeps whole-group RPC',async()=>{
  const f=fixture();const result=await f.run();
  assert.equal(result.error,null);assert.equal(result.data,2);
  assert.equal(f.confirms.length,1);assert.match(f.confirms[0],/including 1 not shown/);assert.match(f.confirms[0],/warnings shown here cover the loaded games only/);
  assert.deepEqual(f.sent,[{name:'assign_official_to_linked_games',args:{p_game_id:'visible',p_position_id:'position',p_official_id:'ref'}}]);
  assert(f.calls.some(call=>call.table==='game_link_members'&&call.operations.some(([op,key])=>op==='eq'&&key==='group_id')));
});
test('cancellation, changed authority and metadata errors do not call assignment RPC',async()=>{
  for(const options of [{accept:false},{canManage:false},{failTable:'game_link_members'},{failTable:'games'},{failTable:'official_league_eligibility'}]){
    const f=fixture(options);assert((await f.run()).error);assert.equal(f.sent.length,0);
  }
});
test('single-game eligible assignment remains available without linked confirmation',async()=>{
  const f=fixture({group:false,eligible:['a']});assert.equal((await f.run()).data,1);assert.equal(f.confirms.length,0);
});
test('all browser linked-assignment mutation paths route through this preflight',()=>{
  const calls=[];function scan(item){if(ts.isCallExpression(item)&&item.expression.getText(ast)==='supabase.rpc'&&item.arguments[0]?.getText(ast)==='"assign_official_to_linked_games"')calls.push(item);ts.forEachChild(item,scan);}scan(ast);
  assert.equal(calls.length,1);assert(calls[0].pos>node.pos&&calls[0].end<node.end);
  assert(source.match(/await assignLinkedOfficial\(/g).length>=6);
});
