const { applyScopeFilter } = require("./support/scope-query.cjs");
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const test = require('node:test');

const json = (body, options) => ({ body, status: options?.status || 200 });
function load(file, dependencies = {}) {
  const module = { exports: {} };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, {
    module, exports: module.exports, console, Date, Set, Map, URLSearchParams, crypto: require('node:crypto').webcrypto,
    process: { env: { RESEND_API_KEY: 'test-only' } },
    require(name) {
      if (name === 'next/server') return { NextResponse: { json } };
      const entry = Object.entries(dependencies).find(([suffix]) => name.endsWith(suffix));
      if (!entry) throw new Error(`Unexpected dependency ${name}`);
      return entry[1];
    },
  });
  return module.exports;
}
const paging = load('lib/supabase/readAll.ts');
function database(seed, errors = {}) {
  const calls = [];
  const get = (row, key) => key.split('.').reduce((value, part) => value?.[part], row);
  return {
    calls,
    from(table) {
      const call = { table, methods: [], mutation: false }; calls.push(call);
      const filters = []; let range; let single = false; let limit;
      const query = {
        then(resolve, reject) {
          let rows = (seed[table] || []).filter(row => filters.every(filter => filter(row)));
          if (limit !== undefined) rows = rows.slice(0, limit);
          if (range) rows = rows.slice(range[0], range[1] + 1);
          return Promise.resolve({ data: errors[table] ? null : single ? rows[0] || null : rows, error: errors[table] || null, count: rows.length }).then(resolve, reject);
        },
      };
      for (const method of ['select','eq','in','is','not','order','range','limit','maybeSingle','single','update','delete','insert','upsert','or']) {
        query[method] = (...args) => {
          call.methods.push([method, ...args]);
          if (method === 'eq' || method === 'is') filters.push(row => get(row,args[0]) === args[1]);
          if (method === 'or') filters.push(row => applyScopeFilter(row,args[0],args[1]));
          if (method === 'in') filters.push(row => args[1].includes(get(row,args[0])));
          if (method === 'range') range = args;
          if (method === 'limit') limit = args[0];
          if (['single','maybeSingle'].includes(method)) single = true;
          if (['update','delete','insert','upsert'].includes(method)) call.mutation = true;
          return query;
        };
      }
      return query;
    },
  };
}
function fixture({ roles = ['admin'], leagues = ['league-a'], leagueAccess, coverage = ['league-a','league-b'], protectedAccount = false, errors } = {}) {
  const seed = {
    organization_memberships: roles.map(role => ({ role, user_id: 'user', organization_id: 'org' })),
    protected_accounts: protectedAccount ? [{ user_id: 'user' }] : [],
    organization_user_access_profiles: [{ organization_id: 'org', user_id: 'user', roles: ['admin'], league_ids: ['league-a','league-b'] }],
    refassign_subscriptions: [{ organization_id: 'org', status: 'active', access_override: false }],
    organization_member_league_access: (leagueAccess || leagues.map(league_id => ({ league_id, all_locations: true, location_ids: [] }))).map(access => ({ ...access, organization_id: 'org', user_id: 'user' })),
    organization_league_coverage: coverage.map((league_id,id) => ({ id, organization_id: 'org', league_id, active: true })),
    organization_locations: ["location-a","location-b"].map(location_id => ({ organization_id:"org",location_id,active:true,locations:{active:true} })),
    games: [
      { id: 'game-a', organization_id: 'org', league_id: 'league-a', location_id:'location-a', archived_at: null, status: 'cancelled' },
      { id: 'game-b', organization_id: 'org', league_id: 'league-b', location_id:'location-b', archived_at: null, status: 'cancelled' },
      { id: 'game-other', organization_id: 'other-org', league_id: 'league-a' },
    ],
    assignments: [
      { id: 'assignment-a', game_id: 'game-a', official_id: 'official-a', games: { organization_id: 'org', league_id: 'league-a', location_id:'location-a' } },
      { id: 'assignment-b', game_id: 'game-b', official_id: 'official-b', games: { organization_id: 'org', league_id: 'league-b', location_id:'location-b' } },
    ],
    organization_officials: ['official-a','official-b'].map(official_id => ({ official_id, organization_id: 'org', active: true })),
    official_league_eligibility: [ { official_id: 'official-a', league_id: 'league-a' }, { official_id: 'official-b', league_id: 'league-b' } ],
  };
  const service = database(seed, errors);
  const auth = load('lib/server/organizationScope.ts', {
    '../supabase/admin': { createServiceClient: () => service },
    '../supabase/server': { createServerSupabaseClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: 'user' } } }) } }) },
    '../supabase/readAll': paging,
  });
  const request = { nextUrl: { searchParams: new URLSearchParams('organizationId=org') } };
  return { auth, request, seed, service };
}

test('admin and admin+assignor+official get only explicit active league scope, never profile fallback', async () => {
  for (const roles of [['admin'],['admin','assignor','official','billing']]) {
    const f = fixture({ roles, leagues: ['league-a','inactive'], coverage: ['league-a','league-b'] });
    const scope = await f.auth.requireManagedOrganization(f.request);
    assert.equal(scope.fullOrganizationAccess, false);
    assert.deepEqual(Array.from(scope.leagueIds), ['league-a']);
    assert.equal(f.service.calls.some(call => call.table === 'organization_user_access_profiles'), false);
    assert.equal(await f.auth.requireGameScope(scope,['game-a']), null);
    assert.equal((await f.auth.requireGameScope(scope,['game-b'])).status,403);
    assert.equal((await f.auth.requireGameScope(scope,['game-a','game-b'])).status,403);
    assert.equal((await f.auth.requireGameScope(scope,['game-other'])).status,403);
  }
});

test('missing scope, removed coverage, revoked membership, and access read failures fail closed', async () => {
  for (const options of [{ leagues: [] },{ coverage: [] },{ roles: [] }]) {
    const f = fixture(options);
    assert.equal((await f.auth.requireManagedOrganization(f.request)).error.status,403);
  }
  const f = fixture({ errors: { organization_member_league_access: { message: 'unavailable' } } });
  assert.equal((await f.auth.requireManagedOrganization(f.request)).error.status,500);
});

test('scope is re-read after revocation instead of trusting previous request/profile', async () => {
  const f = fixture();
  assert.equal((await f.auth.requireManagedOrganization(f.request)).error,undefined);
  f.seed.organization_member_league_access = [];
  assert.equal((await f.auth.requireManagedOrganization(f.request)).error.status,403);
});

test('owner behind other roles and protected superadmin retain broad access; admin cannot use owner-only APIs', async () => {
  for (const options of [{ roles: ['admin','assignor','owner'], leagues: [] },{ roles: [], leagues: [], protectedAccount: true }]) {
    const f = fixture(options), scope = await f.auth.requireOrganizationOwner(f.request);
    assert.equal(scope.fullOrganizationAccess,true);
    assert.equal(scope.leagueIds,null);
    assert.equal(await f.auth.requireGameScope(scope,['game-a','game-b']),null);
    assert.equal((await f.auth.requireGameScope(scope,['game-other'])).status,403);
  }
  const f = fixture();
  assert.equal((await f.auth.requireOrganizationOwner(f.request)).error.status,403);
});

test('assignment, league and official batch guards reject forged, mixed and empty selections', async () => {
  const f = fixture(), scope = await f.auth.requireManagedOrganization(f.request);
  for (const [name, allowed, forbidden] of [
    ['requireAssignmentScope','assignment-a','assignment-b'],
    ['requireLeagueScope','league-a','league-b'],
    ['requireOfficialScope','official-a','official-b'],
  ]) {
    assert.equal(await f.auth[name](scope,[allowed]),null);
    for (const ids of [[forbidden],[allowed,forbidden],[],['missing']])
      assert.equal((await f.auth[name](scope,ids)).status,403);
  }
  assert.equal((await f.auth.requireAssignmentScope(scope,['assignment-a'],'game-b')).status,403);
});

async function routeFixture(file, options = {}) {
  const f = fixture(options), scope = await f.auth.requireManagedOrganization(f.request);
  const route = load(file, {
    '/server/organizationScope': { ...f.auth, requireManagedOrganization: async () => scope },
    '/communications/officialCc': { sendOfficialNotification: async () => { throw new Error('Unauthorized send'); } },
    '/event-time': {},
  });
  return { ...f, route, run: body => route.POST({ ...f.request, json: async () => body }) };
}

test('archive/restore/delete reject complete mixed batches before any mutation, while local archive works', async () => {
  for (const action of ['archive','archive_cancelled','restore','delete']) {
    const f = await routeFixture('app/api/games/manage/route.ts');
    assert.equal((await f.run({ action, gameIds: ['game-a','game-b'] })).status,403);
    assert.equal(f.service.calls.some(call => call.mutation),false);
  }
  const f = await routeFixture('app/api/games/manage/route.ts');
  assert.equal((await f.run({ action:'archive', gameIds:['game-a'] })).status,200);
  const mutation = f.service.calls.find(call => call.mutation);
  assert(mutation.methods.some(([method,key,value]) => method === 'or' && key.includes('league_id.eq.league-a')));
});

test('confirm, publish/retry, status and communications deny forged IDs before content reads or sends', async () => {
  const cases = [
    ['app/api/assignments/confirm/route.ts', { assignmentId:'assignment-b' }],
    ['app/api/assignments/publish/route.ts', { gameId:'game-b' }],
    ['app/api/assignments/publish/route.ts', { gameId:'game-b', retryFailed:true }],
    ['app/api/assignments/publish/route.ts', { gameId:'game-a', assignmentIds:['assignment-a','assignment-b'] }],
    ['app/api/games/status/route.ts', { gameId:'game-b', status:'canceled' }],
    ['app/api/communications/send/route.ts', { assignmentIds:['assignment-a','assignment-b'], channel:'email', messageType:'reminder' }],
  ];
  for (const [file,body] of cases) {
    const f = await routeFixture(file);
    assert.equal((await f.run(body)).status,403,file);
    assert.equal(f.service.calls.some(call => call.mutation),false,file);
    for (const call of f.service.calls.filter(call => ['games','assignments'].includes(call.table)))
      assert(!call.methods.some(([method,selection]) => method === 'select' && /officials\(|response_token|game_number/.test(selection)),file);
  }
});

test('billing authority survives subscription expiry for owners, not stale admins or revoked owners', async () => {
  for (const [options, allowed] of [[{},false],[{ roles:['admin','owner'] },true],[{ roles:[], protectedAccount:true },true]]) {
    const f = fixture(options);
    f.seed.refassign_subscriptions[0].status = 'past_due';
    assert.equal(await f.auth.isCurrentOrganizationOwner(f.service,'org','user'),allowed);
  }
  const f = fixture({ roles:['owner'] });
  assert.equal(await f.auth.isCurrentOrganizationOwner(f.service,'org','user'),true);
  f.seed.organization_memberships = [{ organization_id:'org', user_id:'user', role:'admin' }];
  assert.equal(await f.auth.isCurrentOrganizationOwner(f.service,'org','user'),false);
});

test('tax document list and direct download reject a scoped admin before document content delivery', async () => {
  for (const file of ['app/api/billing/tax-documents/route.ts','app/api/billing/tax-documents/[id]/route.ts']) {
    const f = fixture();
    f.seed.organization_tax_exemption_documents = [{ id:'private-document', organization_id:'org', storage_path:'private-path', original_name:'tax.pdf' }];
    const route = load(file, {
      '/supabase/admin': { createServiceClient: () => f.service },
      '/supabase/server': { createServerSupabaseClient: async () => ({ auth: { getUser: async () => ({ data: { user:{ id:'user' } } }) } }) },
    });
    const request = { nextUrl:{ searchParams:new URLSearchParams('organization_id=org') } };
    const response = await route.GET(request, { params:Promise.resolve({ id:'private-document' }) });
    assert.equal(response.status,403,file);
    assert.equal(f.service.calls.some(call => call.mutation),false);
  }
});

test("league/location pairs constrain dual-role administrators and reject an entire mixed-location batch", async () => {
  const f = fixture({ roles:["admin","assignor","official"], leagues:["league-a","league-b"], coverage:["league-a","league-b"], leagueAccess:[
    { league_id:"league-a",all_locations:false,location_ids:["location-a"] },
    { league_id:"league-b",all_locations:false,location_ids:["location-b"] },
  ] });
  f.seed.games.push({id:"game-a-cross",organization_id:"org",league_id:"league-a",location_id:"location-b"},
    {id:"game-b-cross",organization_id:"org",league_id:"league-b",location_id:"location-a"},
    {id:"game-null",organization_id:"org",league_id:"league-a",location_id:null});
  f.seed.assignments.push({id:"assignment-cross",games:f.seed.games.find(row=>row.id==="game-a-cross")});
  const scope = await f.auth.requireManagedOrganization(f.request);
  assert.equal(await f.auth.requireGameScope(scope,["game-a","game-b"]),null);
  assert.equal((await f.auth.requireLeagueScope(scope,["league-a"])).status,403);
  for (const ids of [["game-a-cross"],["game-b-cross"],["game-null"],["game-a","game-a-cross"]])
    assert.equal((await f.auth.requireGameScope(scope,ids)).status,403);
  assert.equal((await f.auth.requireAssignmentScope(scope,["assignment-a","assignment-cross"])).status,403);
  const route=load("app/api/games/manage/route.ts", {"/server/organizationScope":{...f.auth,requireManagedOrganization:async()=>scope}});
  const result=await route.POST({...f.request,json:async()=>({action:"archive",gameIds:["game-a","game-a-cross"]})});
  assert.equal(result.status,403);
  assert.equal(f.service.calls.some(call => call.methods.some(([method])=>method==="update")),false);
});

test("empty/missing location grants, inactive location links, and location revocation fail closed", async () => {
  for (const grant of [{league_id:"league-a",all_locations:false,location_ids:[]},{league_id:"league-a",location_ids:["missing"]}]) {
    const f = fixture({leagueAccess:[grant]});
    const scope = await f.auth.requireManagedOrganization(f.request);
    assert.equal((await f.auth.requireGameScope(scope,["game-a"])).status,403);
  }
  const f = fixture({leagueAccess:[{league_id:"league-a",all_locations:false,location_ids:["location-a"]}]});
  let scope = await f.auth.requireManagedOrganization(f.request);
  assert.equal(await f.auth.requireGameScope(scope,["game-a"]),null);
  f.seed.organization_locations[0].active=false;
  scope = await f.auth.requireManagedOrganization(f.request);
  assert.equal((await f.auth.requireGameScope(scope,["game-a"])).status,403);
  f.seed.organization_locations[0].active=true;
  f.seed.organization_locations[0].locations.active=false;
  scope = await f.auth.requireManagedOrganization(f.request);
  assert.equal((await f.auth.requireGameScope(scope,["game-a"])).status,403);
});

test("all-locations, owner, and protected-superadmin preserve null/historical location access",async()=>{
  for (const options of [{},{roles:["admin","owner"]},{roles:[],protectedAccount:true}]) {
    const f=fixture(options);
    f.seed.games[0].location_id=null;
    const scope=await f.auth.requireManagedOrganization(f.request);
    assert.equal(await f.auth.requireGameScope(scope,["game-a"]),null);
  }
});

test("payroll batches are indivisible across league/location boundaries",async()=>{
  const f=fixture({leagueAccess:[{league_id:"league-a",all_locations:false,location_ids:["location-a"]}]});
  f.seed.games.push({id:"hidden",organization_id:"org",league_id:"league-a",location_id:"location-b"});
  f.seed.payroll_batches=[{id:"local",organization_id:"org",league_id:"league-a"},{id:"mixed",organization_id:"org",league_id:"league-a"}];
  f.seed.payroll_batch_items=[{id:"item-1",payroll_batch_id:"local",game_id:"game-a",games:f.seed.games[0],payroll_batches:{organization_id:"org"}},
    {id:"item-2",payroll_batch_id:"mixed",game_id:"game-a",games:f.seed.games[0],payroll_batches:{organization_id:"org"}},
    {id:"item-3",payroll_batch_id:"mixed",game_id:"hidden",games:f.seed.games.at(-1),payroll_batches:{organization_id:"org"}}];
  const scope=await f.auth.requireManagedOrganization(f.request);
  assert.equal(await f.auth.requirePayrollBatchScope(scope,"local"),null);
  assert.equal((await f.auth.requirePayrollBatchScope(scope,"mixed")).status,403);
  const batches=await f.auth.accessiblePayrollBatchIds(scope);
  assert.deepEqual(Array.from(batches.data),["local"]);
});

test("payroll direct assignment and vacant-position URLs cannot bypass location scope",async()=>{
  const f=fixture({leagueAccess:[{league_id:"league-a",all_locations:false,location_ids:["location-b"]}]});
  const scope=await f.auth.requireManagedOrganization(f.request);
  const route=load("app/api/payroll/route.ts",{
    "/server/organizationScope":{...f.auth,requireManagedOrganization:async()=>scope},
    "/stripe/runtime":{},
    "/supabase/readAll":paging,
  });
  for (const assignmentId of ["assignment-a","vacant:game-a:position-a"]) {
    const response=await route.PATCH({...f.request,json:async()=>({assignmentId,paymentStatus:"unpaid"})});
    assert.equal(response.status,403);
  }
  assert.equal(f.service.calls.some(call=>call.mutation),false);
});

test("scoped bill-to read preserves payroll choices without exposing other locations or shared directory edits",async()=>{
  const f=fixture({leagueAccess:[{league_id:"league-a",all_locations:false,location_ids:["location-a"]}]});
  f.seed.games=[...Array.from({length:1005},(_,i)=>({id:`hidden-${i}`,organization_id:"org",league_id:"league-a",location_id:"location-b",bill_to_id:"hidden-account"})),
    {id:"local",organization_id:"org",league_id:"league-a",location_id:"location-a",bill_to_id:"local-account"},
    {id:"different-league",organization_id:"org",league_id:"league-b",location_id:"location-a",bill_to_id:"other-league-account"}];
  f.seed.bill_to_accounts=["local-account","hidden-account","other-league-account","unused-account"].map(id=>({id,name:id,email:`${id}@example.test`,organization_id:"org",active:true}));
  f.seed.bill_to_accounts.push({id:"other-org",name:"Other",organization_id:"other",active:true});
  const route=load("app/api/bill-tos/route.ts",{"/server/organizationScope":f.auth,"/supabase/readAll":paging});
  const result=await route.GET(f.request);
  assert.equal(result.status,200);
  assert.equal(result.body.canManageBillTos,false);
  assert.deepEqual(Array.from(result.body.billTos,row=>row.id),["local-account"]);
  const gameReads=f.service.calls.filter(call=>call.table==="games");
  assert.equal(gameReads.length,1);
  assert(gameReads[0].methods.some(([method])=>method==="or"));
  const accountRead=f.service.calls.find(call=>call.table==="bill_to_accounts");
  assert(accountRead.methods.some(([method,column,ids])=>method==="in" && column==="id" && ids.length===1 && ids[0]==="local-account"));
  assert(accountRead.methods.some(([method,columns])=>method==="select" && columns==="id,name,email,active"));
  for(const method of ["POST","PATCH"])
    assert.equal((await route[method]({...f.request,json:async()=>({id:"local-account",name:"Changed",email:"changed@example.test"})})).status,403);
  assert.equal(f.service.calls.some(call=>call.mutation),false);
  f.seed.organization_member_league_access[0].location_ids=[];
  const empty=await route.GET(f.request);
  assert.deepEqual(Array.from(empty.body.billTos),[]);
  f.seed.organization_memberships.push({organization_id:"org",user_id:"user",role:"owner"});
  const owner=await route.GET(f.request);
  assert.equal(owner.body.canManageBillTos,true);
  assert.equal(owner.body.billTos.length,4);
});

test("bill-to discovery errors do not fall back to an organization-wide directory",async()=>{
  const f=fixture({errors:{games:{message:"Game access read failed"}}});
  const route=load("app/api/bill-tos/route.ts",{"/server/organizationScope":f.auth,"/supabase/readAll":paging});
  const result=await route.GET(f.request);
  assert.equal(result.status,500);
  assert.equal(f.service.calls.some(call=>call.table==="bill_to_accounts"),false);
});

test("payroll cannot attach a guessed account outside authorized game pairs before either write",async()=>{
  const f=fixture({leagueAccess:[{league_id:"league-a",all_locations:false,location_ids:["location-a"]}]});
  f.seed.games[0].bill_to_id="local-account";
  f.seed.games.push({id:"hidden-same-league",organization_id:"org",league_id:"league-a",location_id:"location-b",bill_to_id:"hidden-account"});
  f.seed.bill_to_accounts=["local-account","hidden-account","unused-account"].map(id=>({id,organization_id:"org",active:true}));
  const scope=await f.auth.requireManagedOrganization(f.request);
  assert.equal(await f.auth.requireBillToScope(scope,["local-account"]),null);
  assert.equal((await f.auth.requireBillToScope(scope,["local-account","hidden-account"])).status,403);
  const route=load("app/api/payroll/route.ts",{
    "/server/organizationScope":f.auth,"/supabase/readAll":paging,"/stripe/runtime":{},
  });
  for(const billToId of ["hidden-account","unused-account"]){
    const result=await route.PATCH({...f.request,json:async()=>({assignmentId:"assignment-a",billToId,paymentStatus:"approved"})});
    assert.equal(result.status,403);
    assert.equal(f.service.calls.some(call=>call.mutation),false);
  }
  const valid=await route.PATCH({...f.request,json:async()=>({assignmentId:"assignment-a",billToId:"local-account",paymentStatus:"approved"})});
  assert.equal(valid.status,200);
  assert.equal(f.service.calls.filter(call=>call.mutation).length,2);
  const owner=fixture({roles:["owner"]});
  const ownerScope=await owner.auth.requireManagedOrganization(owner.request);
  assert.equal(await owner.auth.requireBillToScope(ownerScope,["any-org-account"]),null);
});
