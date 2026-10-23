const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {fixture,I,id,asUser,value,denied,functionSQL}=require('./support/league-security-fixture.cjs');
const migration=fs.readFileSync('supabase/migrations/20261023093758_personal_assignor_rosters.sql','utf8');
async function setup(){
 const db=await fixture();
 const undo=fs.readFileSync('supabase/migrations/20260909160000_secure_organization_imports_and_undo.sql','utf8');
 await db.exec(`insert into auth.users select distinct user_id,user_id::text||'@example.com' from organization_memberships on conflict do nothing; insert into auth.users values('${I.superadmin}','root@example.com');
 alter table profiles add column full_name text;
 alter table officials add column email text;
 update officials set first_name='Alex',last_name=case when id='${I.officialA}' then 'Alpha' else 'Beta' end,email=case when id='${I.officialA}' then 'alpha@example.com' else 'beta@example.com' end;
 alter table assignments add column position_id uuid,add column assignment_source text;
 grant usage on schema auth to authenticated;
 grant execute on function auth.uid() to authenticated;
 alter default privileges in schema public grant all on tables to anon,authenticated,service_role;
 `);
 await db.exec(`create table public.undo_operations(id uuid primary key default gen_random_uuid(),transaction_id bigint unique,actor_user_id uuid,organization_id uuid,description text,created_at timestamptz default now(),expires_at timestamptz default now()+interval '15 minutes',undone_at timestamptz);
 create table public.undo_changes(id bigint generated always as identity primary key,operation_id uuid,table_name text,row_id uuid,operation text,old_data jsonb,new_data jsonb);
 alter table public.undo_operations enable row level security;
 alter table public.undo_changes enable row level security;
 grant select,update,delete on public.undo_operations to authenticated;
 grant select,update on public.undo_changes to authenticated;
 create policy "Read own Undo changes" on public.undo_changes for select to authenticated using(exists(select 1 from public.undo_operations o where o.id=operation_id and o.actor_user_id=auth.uid()));
 `);
 for(const policy of undo.match(/create policy "Managers (?:view|update|delete) own undo operations"[\s\S]*?;/g)) await db.exec(policy);
 await db.exec(functionSQL(undo,'public.undo_operation'));
 await db.exec(functionSQL(undo,'public.capture_undo_change'));
 await db.exec('create trigger undo_capture_assignments after insert or update or delete on assignments for each row execute function public.capture_undo_change();');
 await db.exec('revoke all on function public.undo_operation(uuid,uuid) from public,anon;grant execute on function public.undo_operation(uuid,uuid) to authenticated;');
 await db.exec(migration);
 return db;
}
const call=(db,name,args)=>db.query(`select public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) value`,args).then(r=>r.rows[0]?.value);
const prepare= async db=>{await db.query("select set_config('request.jwt.claim.sub',$1,false)",[I.owner]);await call(db,'prepare_personal_rosters',[I.org]);await db.query("select set_config('request.jwt.claim.sub','',false)");};
const activate= async db=>{await db.query("select set_config('request.jwt.claim.sub',$1,false)",[I.owner]);await call(db,'activate_personal_rosters',[I.org]);await db.query("select set_config('request.jwt.claim.sub','',false)");};
test('personal roster isolated SQL/RLS runtime regressions',async t=>{
 const db=await setup();
 try{
 await t.test('staging is inert, viewer state works and cannot manage',async()=>{
  await asUser(db,I.admin,async()=>{assert.equal((await call(db,'get_personal_roster_state',[I.org])).enabled,false);});
  await asUser(db,I.viewer,async()=>{assert.equal((await call(db,'get_personal_roster_state',[I.org])).can_manage,false);await denied(db,'select public.set_personal_roster_official($1,$2,true,null)',[I.org,I.officialA]);});
  assert.equal((await db.query('select * from private.personal_roster_settings')).rows.length,0);
 });
 await t.test('preparation owner only; no memberships seeded',async()=>{
  await asUser(db,I.admin,async()=>{await denied(db,'select public.prepare_personal_rosters($1)',[I.org],/owner/i);});
  await prepare(db);assert.equal((await db.query('select * from assignor_official_rosters')).rows.length,0);
 });
 await t.test('scoped name/email search is masked, exact email, no foreign league or wildcard enumeration',async()=>{
  await asUser(db,I.admin,async()=>{
   const r=await db.query('select * from public.search_personal_roster_officials($1,$2)',[I.org,'Alex']);assert.equal(r.rows.length,1);assert.equal(r.rows[0].official_id,I.officialA);assert.equal(r.rows[0].email_hint,'a***@example.com');
   assert.equal((await db.query('select * from public.search_personal_roster_officials($1,$2)',[I.org,'alpha@'])).rows.length,0);
   assert.equal((await db.query('select * from public.search_personal_roster_officials($1,$2)',[I.org,'ALPHA@example.com'])).rows[0].match_exact,true);
   assert.equal((await db.query('select * from public.search_personal_roster_officials($1,$2)',[I.org,'%%'])).rows.length,0);
   await denied(db,'select * from public.search_personal_roster_officials($1,$2,$3)',[I.org,'Alex',I.mixed]);
  });
 });
 await t.test('add/remove affects only own membership, preserves eligibility and assignments',async()=>{
  const before=await db.query('select * from assignments order by id');
  await asUser(db,I.admin,async()=>{
   await call(db,'set_personal_roster_official',[I.org,I.officialA,true,null]);
   assert.equal((await db.query('select * from public.list_personal_roster_official_ids($1)',[I.org])).rows.length,1);
   await denied(db,'select public.set_personal_roster_official($1,$2,true,null)',[I.org,I.officialB],/scope/i);
   await denied(db,'update assignor_official_rosters set assignor_id=$1',[I.mixed],/permission denied/i);
   await denied(db,'insert into assignor_official_rosters values($1,$2,$3,true,now())',[I.org,I.mixed,I.officialA],/permission denied/i);
   await call(db,'set_personal_roster_official',[I.org,I.officialA,false,null]);
   assert.equal((await db.query('select * from public.list_personal_roster_official_ids($1)',[I.org])).rows.length,0);
  });
  assert.deepEqual((await db.query('select * from assignments order by id')).rows,before.rows);
 });
 await t.test('owner import validates whole batch and target scope; no partial additions',async()=>{
  await asUser(db,I.owner,async()=>{
   await denied(db,'select public.set_personal_roster_officials($1,$2,$3)',[I.org,[I.officialA,I.officialB],I.admin],/scope/i);
   assert.equal((await db.query('select * from assignor_official_rosters')).rows.length,0);
   assert.equal(await call(db,'set_personal_roster_officials',[I.org,[I.officialA,I.officialA],I.admin]),1);
   await denied(db,'select public.set_personal_roster_officials($1,$2,$3)',[I.org,[I.officialA],I.viewer]);
  });
 });
 await t.test('activation retains owner-wide; fresh candidate keys blocked for empty assignor',async()=>{
  await activate(db);
  await asUser(db,I.admin,async()=>{
   const state=await call(db,'get_personal_roster_state',[I.org]);assert.equal(state.enabled,true);assert.equal(state.owner_wide,false);
   await denied(db,'insert into assignments(id,game_id,official_id) values($1,$2,$3)',[id(100),I.gameA,I.officialA],/personal roster/i);
   await call(db,'set_personal_roster_official',[I.org,I.officialA,true,null]);
   await db.query('insert into assignments(id,game_id,official_id) values($1,$2,$3)',[id(100),I.gameA,I.officialA]);
   await call(db,'set_personal_roster_official',[I.org,I.officialA,false,null]);
   await db.query("update assignments set status='cancelled' where id=$1",[id(100)]);
   await db.query("update assignments set status='accepted' where id=$1",[id(100)]);
   await denied(db,'update assignments set position_id=$1 where id=$2',[id(101),id(100)],/personal roster/i);
   await db.query("select set_config('refassign.undoing','true',true)");
   await denied(db,'insert into assignments(id,game_id,official_id) values($1,$2,$3)',[id(102),I.gameA,I.officialA],/personal roster/i);
  });
  await asUser(db,I.owner,async()=>{assert.equal((await call(db,'get_personal_roster_state',[I.org])).owner_wide,true);await db.query('insert into assignments(id,game_id,official_id) values($1,$2,$3)',[id(103),I.gameA,I.officialA]);});
 });
 await t.test('revoked league membership immediately stops add and search, no-location grant remains usable',async()=>{
  await asUser(db,I.admin,async()=>{assert.equal((await db.query('select * from public.search_personal_roster_officials($1,$2)',[I.org,'Alex'])).rows.length,1);},`update organization_member_league_access set all_locations=false,location_ids='{}' where user_id='${I.admin}'`);
  await asUser(db,I.admin,async()=>{await denied(db,'select public.set_personal_roster_official($1,$2,true,null)',[I.org,I.officialA]);},`delete from organization_member_league_access where user_id='${I.admin}'`);
 });
 await t.test('activation refuses changed Undo authority rather than silently regressing restoration',async()=>{
  await asUser(db,I.owner,async()=>{await denied(db,'select public.activate_personal_rosters($1)',[I.org],/Undo authority changed/i);},`create or replace function private.can_manage_organization(p_organization_id uuid) returns boolean language sql stable security definer set search_path='' as $$ select true $$`);
 });
 await t.test('actual owner capture and Undo restore survives removing personal membership',async()=>{
  await asUser(db,I.owner,async()=>{
   await call(db,'set_personal_roster_official',[I.org,I.officialA,true,null]);
   await db.query('delete from assignments where id=$1',[I.assignmentA]);
   const operation=(await db.query('select id from undo_operations where actor_user_id=$1',[I.owner])).rows[0];
   assert.ok(operation);
   await call(db,'set_personal_roster_official',[I.org,I.officialA,false,null]);
   await call(db,'undo_operation',[operation.id,I.org]);
   assert.equal((await db.query('select id from assignments where id=$1',[I.assignmentA])).rows.length,1);
  });
 });
 await t.test('actual current owner Undo restores deleted assignment without roster membership; scoped actor remains denied',async()=>{
  const old=(await db.query('select to_jsonb(a) old from assignments a where id=$1',[I.assignmentA])).rows[0].old;
  const setup=`insert into undo_operations(id,actor_user_id,organization_id,description) values('${id(201)}','${I.owner}','${I.org}','Restore assignment'); insert into undo_changes(operation_id,table_name,row_id,operation,old_data) values('${id(201)}','assignments','${I.assignmentA}','DELETE','${JSON.stringify(old)}'); delete from assignments where id='${I.assignmentA}';`;
  await asUser(db,I.owner,async()=>{await call(db,'undo_operation',[id(201),I.org]);assert.equal((await db.query('select id from assignments where id=$1',[I.assignmentA])).rows.length,1);},setup);
  await asUser(db,I.admin,async()=>{await denied(db,'select public.undo_operation($1,$2)',[id(201),I.org],/Undo action not found|not authorized/i);},setup.replace(I.owner,I.admin));
 });
 await t.test('all table privileges stay private and other assignor IDs cannot be read',async()=>{
  await asUser(db,I.admin,async()=>{
   await denied(db,'select * from public.list_personal_roster_official_ids($1,$2)',[I.org,I.mixed]);
   await denied(db,'select * from public.list_personal_roster_assignors($1)',[I.org],/owner/i);
   await denied(db,'select public.activate_personal_rosters($1)',[I.org],/owner/i);
   assert.equal(await value(db,'select private.personal_roster_candidate_allowed($1,$2,$3) value',[I.org,I.owner,I.officialA]),false);
  });
  await asUser(db,I.owner,async()=>{const r=await db.query('select * from public.list_personal_roster_assignors($1)',[I.org]); assert.ok(r.rows.some(x=>x.user_id===I.admin));assert.ok(!r.rows.some(x=>x.user_id===I.viewer));assert.ok(!r.rows.some(x=>x.user_id===I.owner));assert.ok(!r.rows.some(x=>x.user_id===I.superadmin));});
 });
 await t.test('nonmanager self-service and dual-role explicit self-assign preserve existing authority',async()=>{
  await asUser(db,I.mixed,async()=>{await db.query('insert into assignments(id,game_id,official_id,assignment_source) values($1,$2,$3,$4)',[id(110),I.gameA,I.ownOfficial,'self_assign']);});
 });
 await t.test('no direct writes including inherited service-role privileges and no anon callable APIs',async()=>{
  for(const role of ['anon','authenticated','service_role'])for(const op of ['INSERT','UPDATE','DELETE','TRUNCATE'])assert.equal(await value(db,'select has_table_privilege($1,$2,$3) value',[role,'public.assignor_official_rosters',op]),false);
  assert.equal(await value(db,"select has_function_privilege('anon','public.get_personal_roster_state(uuid)','execute') value"),false);
  assert.equal(await value(db,"select has_function_privilege('authenticated','private.guard_personal_roster_assignment()','execute') value"),false);
 });
 }finally{await db.close()}
});

test('AutoAssign source is unchanged except for roster candidate narrowing',()=>{
 const original=functionSQL(fs.readFileSync('supabase/migrations/20261022195617_scope_administrators_to_selected_leagues.sql','utf8'),'public.run_my_auto_assign');
 const revised=functionSQL(migration,'public.run_my_auto_assign');
 assert.equal(revised.replace('        and private.personal_roster_candidate_allowed(p_organization_id,auth.uid(),official.id)\n',''),original);
});
