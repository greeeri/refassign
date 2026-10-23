const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { fixture, I, id, asUser } = require('./support/league-security-fixture.cjs');
const sql = fs.readFileSync('supabase/migrations/20261023093720_assignment_matching_totals_pages_rebuilt.sql', 'utf8')
 + (process.env.REFASSIGN_MATCHING_BASELINE === '1' ? '' : [
 '20261023120507_optimize_assignment_matching_reads.sql',
 '20261023124553_optimize_assignment_matching_fact_joins.sql',
 '20261023125012_inline_assignment_matching_totals_predicates.sql',
 '20261023155245_assignment_today_forward_page.sql',
 ].map(name => fs.readFileSync(`supabase/migrations/${name}`, 'utf8')).join('\n'));
const asOf = '2026-10-23T12:00:00Z';
async function setup() {
 const db = await fixture();
 await db.exec(`
 alter table public.games add column sport_id uuid default '${id(80)}',add column officials_needed int default 3,
  add column archived_at timestamptz,add column time_tbd boolean default false;
 alter table public.locations add column state text default 'IA';
 alter table public.assignments add column position_id uuid,add column assignment_source text default 'manager';
 alter table public.audit_history add column action text,add column old_data jsonb;
 create table public.sport_positions(id uuid,sport_id uuid,sort_order int);
 create table public.assignment_self_assign_slots(game_id uuid,position_id uuid,status text);
 grant select on public.sport_positions,public.assignment_self_assign_slots to authenticated;
 alter table public.assignment_self_assign_slots enable row level security;
 create policy "self assign read" on public.assignment_self_assign_slots for select to authenticated using(exists(select 1 from public.games g where g.id=game_id));
 insert into public.sport_positions values('${id(81)}','${id(80)}',1),('${id(82)}','${id(80)}',2),('${id(83)}','${id(80)}',3),('${id(84)}','${id(80)}',4);
 update public.games set starts_at='2026-10-23 18:00Z';
 update public.assignments set position_id='${id(81)}';
 `);
 await db.exec(sql);
 return db;
}
async function page(db, filters={}, p=1, size=50,org=I.org) {
 return (await db.query('select * from public.get_assignment_matching_game_page($1,$2,$3,$4)',[org,JSON.stringify({asOf,...filters}),p,size])).rows.map(r=>r.game_id);
}
async function total(db,filters={},org=I.org) {
 return (await db.query('select public.get_assignment_matching_game_totals($1,$2) value',[org,JSON.stringify({asOf,...filters})])).rows[0].value;
}
async function seed(db,n,fields={}) {
 const row={id:id(n),organization_id:I.org,league_id:I.a,location_id:I.locationA,starts_at:'2026-10-23T18:00Z',...fields};
 const keys=Object.keys(row);
 await db.query(`insert into public.games(${keys.join(',')}) values(${keys.map((_,i)=>`$${i+1}`).join(',')})`,Object.values(row));
 return row.id;
}
test('matching RPC security, counts, pagination, date and assignment semantics',async t=>{
 const db=await setup();
 try {
 await t.test('invoker, empty search path and no anonymous execute on all seven functions',async()=>{
  const rows=(await db.query("select proname,prosecdef,proconfig,has_function_privilege('anon',p.oid,'execute') anonymous from pg_proc p where proname like 'assignment_matching_%' or proname like 'get_assignment_matching_game_%'")).rows;
  assert.equal(rows.length,7); assert(rows.every(r=>!r.prosecdef&&!r.anonymous));
  assert(rows.every(r=>r.proconfig?.includes('search_path=""')));
 });
 await t.test('scoped admin cannot infer hidden league or other organization through counts/facets',async()=>{
  await asUser(db,I.admin,async()=>{
   assert.deepEqual(await page(db),[I.gameA]);
   assert.equal((await total(db)).total,1);
   assert.equal((await total(db,{leagueId:I.b})).total,0);
   const hidden=await total(db,{},I.otherOrg);
   assert.equal(hidden.total,0); assert(Object.values(hidden.ranges).every(n=>n===0));
   assert.deepEqual(await page(db,{},1,50,I.otherOrg),[]);
  });
  await asUser(db,I.mixed,async()=>{
   assert((await db.query('select id from public.games')).rows.some(r=>r.id===I.gameOwnB),'fixture must retain personal access outside grants');
   assert.deepEqual(await page(db),[I.gameA]);
   assert.equal((await total(db,{leagueId:I.b})).total,0);
  });
  await asUser(db,I.empty,async()=>assert.equal((await total(db)).total,0));
  await asUser(db,null,async()=>assert.equal((await total(db)).total,0));
  await asUser(db,I.owner,async()=>assert.equal((await total(db)).total,3));
 });
 await t.test('location restriction survives broad filters and private facts remain caller-scoped',async()=>{
  await asUser(db,I.admin,async()=>{
   assert.equal((await total(db,{leagueId:I.a})).total,0);
   assert.equal((await db.query('select count(*)::int n from private.assignment_matching_facts($1,$2)',[I.org,asOf])).rows[0].n,0);
  },`update public.organization_member_league_access set all_locations=false,location_ids=array['${I.locationB}'::uuid] where user_id='${I.admin}'`);
 });
 await t.test('filters before 50-row pagination with stable tie ordering and arbitrary pages',async()=>{
  for(let n=100;n<225;n++) await seed(db,n,{time_tbd:n%2===0});
  await asUser(db,I.admin,async()=>{
   const filters={times:['13:00']};
   const first=await page(db,filters),second=await page(db,filters,2);
   assert.equal(first.length,50); assert.equal(second.length,13);
   assert.equal(new Set([...first,...second]).size,63);
   assert.equal((await total(db,filters)).total,63);
   assert.equal((await page(db,filters,1,500)).length,50);
   assert.deepEqual(await page(db,filters,3),[]);
   assert.deepEqual([...first,...second],[I.gameA,...Array.from({length:62},(_,i)=>id(101+i*2))]);
  });
  await db.exec(`delete from public.games where id>='${id(100)}' and id<'${id(225)}'`);
 });
 await t.test('upcoming default; explicit league includes past; all facets agree after selection',async()=>{
  await seed(db,300,{starts_at:'2026-10-20T18:00Z'});
  await asUser(db,I.admin,async()=>{
   assert.equal((await total(db)).total,1);
   const filters={leagueId:I.a};
   const totals=await total(db,filters);
   assert.equal(totals.total,2); assert.equal(totals.ranges.all,2);
   for(const range of ['all','today','tomorrow','thisWeek','nextWeek']) {
    assert.equal(totals.ranges[range],(await total(db,{...filters,range})).total);
   }
   assert.deepEqual(await page(db,{focusGameId:id(300)}),[id(300)]);
   assert.deepEqual(await page(db,{leagueId:I.a,focusGameId:I.gameA}),[id(300),I.gameA]);
  });
 });
 await t.test('inclusive From/To and exact-day combine with league, TBD date retained',async()=>{
  await seed(db,301,{starts_at:'2026-10-24T04:59Z',time_tbd:true});
  await seed(db,302,{starts_at:'2026-10-24T05:00Z'});
  await asUser(db,I.admin,async()=>{
   const f={leagueId:I.a,range:'dateRange',fromDate:'2026-10-23',toDate:'2026-10-23'};
   assert.deepEqual(await page(db,f),[I.gameA,id(301)]);
   assert.equal((await total(db,f)).total,2);
   assert.deepEqual(await page(db,{...f,range:'custom',customDate:'2026-10-23'}),[I.gameA,id(301)]);
   assert.deepEqual(await page(db,{...f,fromDate:'2026-10-24',toDate:''}),[id(302)]);
   assert.deepEqual(await page(db,{...f,fromDate:'',toDate:'2026-10-20'}),[id(300)]);
   assert.deepEqual(await page(db,{...f,times:['23:59']}),[]);
   assert.deepEqual(await page(db,{...f,locationIds:[]}),[]);
  });
 });
 await t.test('venue-local zones, Monday week boundaries and DST calendar dates',async()=>{
  await db.exec(`update public.locations set state='CA' where id='${I.locationA}'`);
  await asUser(db,I.admin,async()=>{
   assert.deepEqual(await page(db,{range:'custom',customDate:'2026-10-23'}),[I.gameA,id(301),id(302)]);
  });
  await seed(db,310,{starts_at:'2026-11-01T08:30Z'});
  await seed(db,311,{starts_at:'2026-11-01T09:30Z'});
  await asUser(db,I.admin,async()=>{
   assert.deepEqual(await page(db,{range:'custom',customDate:'2026-11-01',times:['01:30']}),[id(310),id(311)]);
   assert.equal((await total(db,{range:'thisWeek',asOf:'2026-11-01T12:00Z'})).total,2);
   assert.equal((await total(db,{range:'nextWeek',asOf:'2026-10-25T12:00Z'})).total,2);
  });
  await db.exec(`update public.locations set state='IA' where id='${I.locationA}'`);
 });
 await t.test('assignment completeness exact slots, replacements/audit, deadlines and extras',async()=>{
  for(let n=400;n<407;n++)await seed(db,n);
  const add=async(game,pos,status='accepted',published=true,extra={})=>{
   await db.query('insert into public.assignments(id,game_id,official_id,position_id,status,published_at,accept_by,assignment_source) values($1,$2,$3,$4,$5,$6,$7,$8)',[id(1000+game*10+pos),id(game),I.officialA,id(80+pos),status,published?'2026-10-22T00:00Z':null,extra.accept_by||null,extra.source||'manager']);
  };
  await add(401,1); // partial
  for(let p=1;p<=3;p++){await add(402,p,'proposed',false);await add(403,p,'proposed');await add(404,p);await add(405,p,'proposed',true,{accept_by:'2026-10-22T12:00Z'});}
  await add(406,1,'declined'); // replacement
  await add(404,4,'declined'); // extra irrelevant
  await asUser(db,I.admin,async()=>{
   const byStatus={unassigned:400,partial:401,full:402,awaiting:403,confirmed:404,attention:405};
   for(const [state,n] of Object.entries(byStatus)){
    assert((await page(db,{completeness:[state]})).includes(id(n)),state);
   }
   assert((await page(db,{completeness:['attention']})).includes(id(406)));
   assert((await page(db,{replacementOnly:true})).includes(id(406)));
   assert(!(await page(db,{replacementOnly:true})).includes(id(405)));
   assert(!(await page(db,{replacementOnly:true})).includes(id(404)));
   assert((await page(db,{officialId:I.officialA})).includes(id(404)));
   assert(!(await page(db,{officialId:I.officialA})).includes(id(406)));
  });
  await db.exec(`insert into public.audit_history(organization_id,game_id,action,old_data) values('${I.org}','${id(400)}','unassigned','{"position_id":"${id(81)}"}')`);
  await asUser(db,I.admin,async()=>assert((await page(db,{replacementOnly:true})).includes(id(400))));
  await add(400,1);
  await asUser(db,I.admin,async()=>assert(!(await page(db,{replacementOnly:true})).includes(id(400))));
 });
 await t.test('all queue counts equal their actual click result, preserving other facets',async()=>{
  await db.exec(`insert into public.assignment_self_assign_slots values('${id(402)}','${id(81)}','open'),('${id(406)}','${id(81)}','open')`);
  await asUser(db,I.admin,async()=>{
   const f={leagueId:I.a,selfAssignOnly:true,unpublishedOnly:true,completeness:['full']};
   const c=await total(db,f);
   assert.equal(c.queue.replacement,(await total(db,{...f,replacementOnly:true,selfAssignOnly:false,unpublishedOnly:false,completeness:[]})).total);
   assert.equal(c.queue.unpublished,(await total(db,{...f,unpublishedOnly:true,replacementOnly:false,completeness:[]})).total);
   for(const state of ['attention','unassigned','awaiting'])assert.equal(c.queue[state],(await total(db,{...f,completeness:[state],replacementOnly:false})).total);
   assert.equal(c.unpublished,(await total(db,{...f,unpublishedOnly:true,replacementOnly:false})).total);
   assert.equal(c.allStatuses,(await total(db,{...f,completeness:[],replacementOnly:false})).total);
   assert.equal(c.selfAssign,c.total);
  });
 });
 await t.test('archived games excluded; invalid filters fail clearly and empty results total zero',async()=>{
  await db.exec(`update public.games set archived_at=now() where id='${id(402)}'`);
  await asUser(db,I.admin,async()=>{
   assert(!(await page(db,{unpublishedOnly:true})).includes(id(402)));
   assert.equal((await total(db,{leagueId:id(999999)})).total,0);
  });
  for(const filters of [{range:'invalid'},{days:{}},{range:'dateRange',fromDate:'2026-10-24',toDate:'2026-10-23'}]) {
   await assert.rejects(asUser(db,I.admin,()=>page(db,filters)),/Invalid|must not be after/);
  }
 });
 await t.test('today-forward includes earlier venue-local today, excludes yesterday even with league and status',async()=>{
  await seed(db,770,{starts_at:'2026-10-23T05:00Z'});
  await seed(db,771,{starts_at:'2026-10-23T04:59Z'});
  await seed(db,772,{starts_at:'2026-10-24T18:00Z'});
  await asUser(db,I.admin,async()=>{
   const f={todayForward:true,leagueId:I.a}; const ids=await page(db,f,1,50);
   assert(ids.includes(id(770))); assert(!ids.includes(id(771)));
   assert((await page(db,{...f,completeness:['unassigned']})).includes(id(770)));
   const all=[]; for(let n=1;n<10;n++){const ids=await page(db,f,n);all.push(...ids);if(ids.length<50)break;}
   assert.equal((await total(db,f)).total,all.length);
   const base={todayForward:true,asOf:'2026-10-23T12:00Z'};
   const first=await page(db,base); assert(first.includes(id(770)));
   for(const filters of [base,{...base,completeness:['unassigned']},{...f,completeness:['unassigned']}]) {
    const ids=[];for(let n=1;n<10;n++){const chunk=await page(db,filters,n);ids.push(...chunk);if(chunk.length<50)break;}
    assert.equal((await total(db,filters)).total,ids.length);
   }
   const past={...f,customDate:'2026-10-22'};
   const pastCount=(await total(db,{...past,range:'custom'})).total;
   assert(pastCount>0); assert.equal((await total(db,past)).ranges.custom,pastCount);
   assert(!(await page(db,{...f,completeness:['unassigned']})).includes(id(771)));
   assert((await page(db,{...f,range:'custom',customDate:'2026-10-22'})).includes(id(771)));
   assert(!(await page(db,{...f,leagueId:I.b})).includes(I.gameB));
   const a=await page(db,f,1,2),b=await page(db,f,2,2); assert.equal(new Set([...a,...b]).size,4);
  });
 });
 await t.test('today-forward mapped zones and 25-hour fall-back day use venue midnight',async()=>{
  await seed(db,780,{starts_at:'2026-11-01T04:00Z'}); await seed(db,781,{starts_at:'2026-11-01T03:59Z'});
  for(const [state,midnight] of [['NY','04'],['IA','05'],['CO','06'],['CA','07'],['AZ','07'],['AK','08'],['HI','10']]) {
   await db.query('update public.locations set state=$1 where id=$2',[state,I.locationA]);
   await db.query('update public.games set starts_at=$1::timestamptz where id=$2',[`2026-11-01T${midnight}:00Z`,id(780)]);
   await db.query("update public.games set starts_at=$1::timestamptz-interval '1 minute' where id=$2",[`2026-11-01T${midnight}:00Z`,id(781)]);
   await asUser(db,I.admin,async()=>{
    const ids=await page(db,{todayForward:true,leagueId:I.a,asOf:'2026-11-02T04:30Z'});
    assert(ids.includes(id(780)),state+' includes midnight'); assert(!ids.includes(id(781)),state+' excludes yesterday');
   });
  }
  await db.query('update public.locations set state=$1 where id=$2',['IA',I.locationA]);
  await db.exec('revoke select on public.audit_history from authenticated');
  await asUser(db,I.admin,async()=>assert((await page(db,{todayForward:true,leagueId:I.a})).length>0));
  await db.exec('grant select on public.audit_history to authenticated');
 });
 await t.test('1,395-game production-cardinality isolated benchmark',async()=>{
  await db.exec(`create index on public.assignments(game_id,position_id); create index on public.audit_history(game_id,action); create index on public.assignment_self_assign_slots(game_id);
   drop policy legacy_permissive on public.locations;
   create policy "Authorized game viewers read locations" on public.locations for select to authenticated
    using((select auth.uid()) is not null and exists(select 1 from public.games game where game.location_id=locations.id));
   drop policy legacy_permissive on public.audit_history;
   create policy "Organization users view audit history" on public.audit_history for select to authenticated
    using(exists(select 1 from public.organization_memberships m where m.organization_id=audit_history.organization_id and m.user_id=(select auth.uid())
      and (m.role in ('owner','admin','assignor') or (m.role='viewer' and 'reporting'=any(m.viewer_permissions)))));
   delete from public.assignments; delete from public.audit_history; delete from public.assignment_self_assign_slots; delete from public.games; delete from public.locations;
   insert into public.locations(id,name,state) select ('00000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'Fixture location',case when n%5=0 then 'CA' else 'IA' end from generate_series(20000,20154) n;
   insert into public.organization_locations(organization_id,location_id,active) select '${I.org}',id,true from public.locations;
   insert into public.games(id,organization_id,league_id,location_id,starts_at)
    select ('00000000-0000-4000-8000-'||lpad((10000+n)::text,12,'0'))::uuid,'${I.org}',case when n%2=0 then '${I.a}'::uuid else '${I.b}'::uuid end,
     ('00000000-0000-4000-8000-'||lpad((20000+n%155)::text,12,'0'))::uuid,
     case when n<1050 then '2026-09-01 18:00Z'::timestamptz else '2027-01-01 18:00Z'::timestamptz end+make_interval(mins=>n)
    from generate_series(0,1394) n;
   insert into public.assignments(id,game_id,official_id,position_id,status,published_at)
     select ('00000000-0000-4000-8000-'||lpad((30000+n)::text,12,'0'))::uuid,
      ('00000000-0000-4000-8000-'||lpad((10000+n)::text,12,'0'))::uuid,'${I.officialA}','${id(81)}','accepted',now() from generate_series(0,811) n;
   insert into public.audit_history(organization_id,game_id,action,old_data)
    select '${I.org}',('00000000-0000-4000-8000-'||lpad((10000+n%1395)::text,12,'0'))::uuid,
     case when n%4=0 then 'unassigned' else 'updated' end,jsonb_build_object('position_id','${id(82)}') from generate_series(1,13929) n;
   insert into public.assignment_self_assign_slots(game_id,position_id,status)
    select ('00000000-0000-4000-8000-'||lpad((10000+n)::text,12,'0'))::uuid,'${id(83)}','open' from generate_series(0,398) n;
  `);
  if(process.env.REFASSIGN_MATCHING_ANALYZE==='1') await db.exec('analyze');
  await asUser(db,I.owner,async()=>{
   if(process.env.REFASSIGN_MATCHING_PLAN==='1') {
    const migration=fs.readFileSync('supabase/migrations/20261023120507_optimize_assignment_matching_reads.sql','utf8');
    const body=migration.split('as $$')[1].split('$$;')[0]
      .replaceAll('p_organization_id',"'"+I.org+"'::uuid").replaceAll('p_as_of',"'"+asOf+"'::timestamptz")
      .replaceAll('p_game_id','null::uuid').replaceAll('p_base_filters',"'{}'::jsonb");
    const plan=await db.query('explain (analyze,buffers,format json) '+body);
    fs.writeFileSync('/tmp/matching-optimized-facts-plan.json',JSON.stringify(plan.rows,null,2));
   }
   const start=performance.now(); const c=await total(db); const elapsed=performance.now()-start;
   assert.equal(c.total,345); console.log(`1395 games/155 locations/812 assignments/13929 audit/399 selfassign totals benchmark: ${Math.round(elapsed)} ms; ${c.total} upcoming`);
   const pstart=performance.now(); assert.equal((await page(db)).length,50);
   console.log(`1395-game default first page benchmark: ${Math.round(performance.now()-pstart)} ms`);
   const todayStart=performance.now(); assert.equal((await page(db,{todayForward:true})).length,50);
   console.log(`1395-game today-forward first page benchmark: ${Math.round(performance.now()-todayStart)} ms`);
  });
 });
 } finally {await db.close();}
});
