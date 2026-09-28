// Isolated SQL transaction smoke test. Requires @electric-sql/pglite locally.
const { PGlite } = require('@electric-sql/pglite');
const fs = require('node:fs');
const assert = require('node:assert/strict');

const USER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ORG = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const SPORT = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const LEAGUE = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const LEVEL = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const LOC1 = '11111111-1111-4111-8111-111111111111';
const LOC2 = '22222222-2222-4222-8222-222222222222';
const LOC3 = '33333333-3333-4333-8333-333333333333';
const LOC4 = '12121212-1212-4121-8121-121212121212';
const GAME1 = '44444444-4444-4444-8444-444444444444';
const GAME2 = '55555555-5555-4555-8555-555555555555';
const GAME3 = '66666666-6666-4666-8666-666666666666';
const GAME4 = '13131313-1313-4131-8131-131313131313';
const POS1 = '77777777-7777-4777-8777-777777777777';
const POS2 = '88888888-8888-4888-8888-888888888888';
const OFF1 = '99999999-9999-4999-8999-999999999999';
const OFF2 = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

async function setup(db) {
  await db.exec(`
    create role anon; create role authenticated;
    create schema auth; create schema private;
    create function auth.uid() returns uuid language sql stable as $$ select '${USER}'::uuid $$;
    create table public.sports(id uuid primary key,name text);
    create table public.locations(id uuid primary key,name text,venue_id uuid,address text,city text,state text,latitude double precision,longitude double precision);
    create table public.organization_locations(organization_id uuid,location_id uuid,active boolean default true,primary key(organization_id,location_id));
    create table public.games(id uuid primary key,game_number text,sport_id uuid,league_id uuid,level_id uuid,organization_id uuid,
      location_id uuid,starts_at timestamptz,status text,time_tbd boolean default false,archived_at timestamptz,
      duration_minutes integer default 110,officials_needed integer,home_team_id uuid,away_team_id uuid);
    create table public.sport_positions(id uuid primary key,sport_id uuid,name text,sort_order integer);
    create table public.officials(id uuid primary key,active boolean,sports text[]);
    create table public.organization_officials(organization_id uuid,official_id uuid,active boolean);
    create table public.official_league_eligibility(official_id uuid,league_id uuid);
    create table public.official_level_eligibility(official_id uuid,level_id uuid,center_eligible boolean,ar_eligible boolean);
    create table public.official_mentor_certifications(official_id uuid,certified boolean);
    create table public.official_availability_blocks(official_id uuid,block_type text,starts_at timestamptz,ends_at timestamptz,
      start_date date,end_date date,location_id uuid,team_id uuid);
    create table public.organization_memberships(organization_id uuid,user_id uuid,role text);
    create table public.organization_user_access_profiles(organization_id uuid,user_id uuid,roles text[],league_ids uuid[]);
    create table public.protected_accounts(user_id uuid);
    create table public.organization_member_league_access(organization_id uuid,user_id uuid,league_id uuid);
    create table public.game_link_members(game_id uuid);
    create table public.game_position_pay(game_id uuid,position_id uuid,amount numeric,payment_status text,primary key(game_id,position_id));
    create table public.assignments(id uuid primary key default gen_random_uuid(),game_id uuid references public.games(id),position_id uuid,
      official_id uuid,status text default 'proposed',published_at timestamptz,responded_at timestamptz,
      assigned_at timestamptz default now(),payment_status text default 'unpaid',game_fee numeric default 0,assignment_source text default 'manager',
      response_token uuid unique,
      unique(game_id,position_id),unique(game_id,official_id));
    create table public.payroll_batch_items(assignment_id uuid);
    create table public.payroll_fee_corrections(assignment_id uuid);
    create table public.assignment_check_ins(assignment_id uuid references public.assignments(id) on delete cascade,checked_in_at timestamptz,checked_in_by uuid);
    create table public.audit_history(entity_type text,entity_id uuid,game_id uuid,assignment_id uuid,action text,actor_user_id uuid,actor_name text,summary text);
    create function public.audit_actor_name(uuid) returns text language sql as $$ select 'Tester'::text $$;
    create function private.payee_delete_guard() returns trigger language plpgsql as $$begin
      if old.payment_status in ('paid','approved') or exists(select 1 from public.payroll_batch_items where assignment_id=old.id)
        then raise exception 'Payroll is protected'; end if;
      insert into public.game_position_pay values(old.game_id,old.position_id,old.game_fee,'unpaid')
        on conflict(game_id,position_id) do update set amount=excluded.amount;
      return old; end;$$;
    create trigger payee_guard before delete on public.assignments for each row execute function private.payee_delete_guard();
    create function private.default_fee() returns trigger language plpgsql as $$begin
      select amount into new.game_fee from public.game_position_pay where game_id=new.game_id and position_id=new.position_id;
      new.game_fee:=coalesce(new.game_fee,0); return new;end;$$;
    create trigger default_fee before insert on public.assignments for each row execute function private.default_fee();
  `);
  const migration = fs.readFileSync('supabase/migrations/20260928020000_transfer_switch_officials.sql','utf8');
  await db.exec(migration);
  await db.exec(`
    insert into public.sports values('${SPORT}','Soccer');
    insert into public.locations(id,name,address,city,state,latitude,longitude) values
      ('${LOC1}','Green 1','1000 Heritage Drive','Grimes','IA',41.7,-93.8),
      ('${LOC2}','Green 2','1000 Heritage Drive','Grimes','IA',41.7,-93.8),
      ('${LOC3}','Other','Elsewhere','Grimes','IA',41.8,-93.8),
      ('${LOC4}','Green 3','1002 Heritage Drive','Grimes','IA',41.7001,-93.8001);
    insert into public.games(id,game_number,sport_id,league_id,level_id,organization_id,location_id,starts_at,status,officials_needed) values
      ('${GAME1}','100','${SPORT}','${LEAGUE}','${LEVEL}','${ORG}','${LOC1}','2026-10-03 15:00+00','active',2),
      ('${GAME2}','101','${SPORT}','${LEAGUE}','${LEVEL}','${ORG}','${LOC2}','2026-10-03 15:00+00','active',2),
      ('${GAME3}','102','${SPORT}','${LEAGUE}','${LEVEL}','${ORG}','${LOC3}','2026-10-03 15:00+00','active',2),
      ('${GAME4}','103','${SPORT}','${LEAGUE}','${LEVEL}','${ORG}','${LOC4}','2026-10-03 15:00+00','active',2);
    insert into public.sport_positions values('${POS1}','${SPORT}','Center Referee',1),('${POS2}','${SPORT}','Assistant Referee 1',2);
    insert into public.officials values('${OFF1}',true,array['Soccer']),('${OFF2}',true,array['Soccer']);
    insert into public.organization_officials values('${ORG}','${OFF1}',true),('${ORG}','${OFF2}',true);
    insert into public.official_league_eligibility values('${OFF1}','${LEAGUE}'),('${OFF2}','${LEAGUE}');
    insert into public.official_level_eligibility values('${OFF1}','${LEVEL}',true,true),('${OFF2}','${LEVEL}',true,true);
    insert into public.organization_memberships values('${ORG}','${USER}','assignor');
    insert into public.game_position_pay values('${GAME1}','${POS1}',50,'unpaid'),('${GAME2}','${POS1}',80,'unpaid');
  `);
}

async function move(db,id,target=GAME2,mode='transfer',accept=true,override=false){
  return db.query('select public.move_official_between_fields($1,$2,$3,$4,$5,$6) result',[id,target,POS1,mode,accept,override]);
}
async function assignment(db,game,official,position=POS1){
  const r=await db.query('insert into public.assignments(game_id,position_id,official_id,status) values($1,$2,$3,$4) returning *',[game,position,official,'accepted']);
  return r.rows[0];
}
async function fresh(){const db=new PGlite();await setup(db);return db;}
async function expectReject(action,pattern){await assert.rejects(action,pattern);}

(async()=>{
  {
    const db=await fresh(); const a=await assignment(db,GAME1,OFF1);
    const originalToken='aaaaaaaa-aaaa-4aaa-8aaa-111111111111';
    await db.query('update public.assignments set response_token=$1 where id=$2',[originalToken,a.id]);
    const result=(await move(db,a.id)).rows[0].result;
    assert.equal((await db.query('select count(*)::int n from public.assignments where game_id=$1',[GAME1])).rows[0].n,0);
    const target=(await db.query('select * from public.assignments where id=$1',[result.targetAssignmentId])).rows[0];
    assert.equal(target.official_id,OFF1); assert.equal(Number(target.game_fee),80); assert.equal(target.status,'accepted');
    assert.equal(target.response_token,originalToken);
    await db.close(); console.log('PASS transfer, accept, destination game pay');
  }
  {
    const db=await fresh(); const a=await assignment(db,GAME1,OFF1); const b=await assignment(db,GAME2,OFF2);
    const sourceToken='aaaaaaaa-aaaa-4aaa-8aaa-111111111111',targetToken='aaaaaaaa-aaaa-4aaa-8aaa-222222222222';
    await db.query('update public.assignments set response_token=$1 where id=$2',[sourceToken,a.id]);
    await db.query('update public.assignments set response_token=$1 where id=$2',[targetToken,b.id]);
    await db.query('insert into public.assignment_check_ins values($1,now(),$2)',[a.id,USER]);
    const result=(await move(db,a.id,GAME2,'switch',false)).rows[0].result;
    const rows=(await db.query('select * from public.assignments order by game_id')).rows;
    assert.equal(rows.length,2); assert.equal(rows.find(x=>x.game_id===GAME1).official_id,OFF2);
    assert.equal(rows.find(x=>x.game_id===GAME2).official_id,OFF1);
    assert.equal(rows.find(x=>x.game_id===GAME2).response_token,sourceToken);
    assert.equal(rows.find(x=>x.game_id===GAME1).response_token,targetToken);
    assert.ok(rows.every(x=>x.status==='proposed' && x.published_at===null));
    const check=(await db.query('select assignment_id from public.assignment_check_ins')).rows;
    assert.equal(check.length,1); assert.equal(check[0].assignment_id,result.targetAssignmentId);
    await db.close(); console.log('PASS switch, notify state, check-in follows official');
  }
  {
    const db=await fresh();const a=await assignment(db,GAME1,OFF1);
    await expectReject(()=>move(db,a.id,GAME3),/same complex/i);
    assert.equal((await db.query('select count(*)::int n from public.assignments where id=$1',[a.id])).rows[0].n,1);
    await db.close();console.log('PASS wrong complex rejected without partial move');
  }
  {
    const db=await fresh();const a=await assignment(db,GAME1,OFF1);
    await expectReject(()=>move(db,a.id,GAME4),/same complex/i);
    await db.query('insert into public.organization_locations(organization_id,location_id) values($1,$2),($1,$3)',[ORG,LOC1,LOC4]);
    await db.query('select public.set_organization_field_complex($1,$2,$3)',[ORG,LOC1,'Green Complex']);
    await db.query('select public.set_organization_field_complex($1,$2,$3)',[ORG,LOC4,'Green Complex']);
    assert.equal((await db.query('select count(*)::int n from public.get_organization_field_complexes($1) where field_complex=$2',[ORG,'Green Complex'])).rows[0].n,2);
    const result=(await move(db,a.id,GAME4)).rows[0].result;
    assert.equal((await db.query('select game_id from public.assignments where id=$1',[result.targetAssignmentId])).rows[0].game_id,GAME4);
    await db.close();console.log('PASS organization field complex permits nearby fields with different addresses');
  }
  {
    const db=await fresh();
    await expectReject(()=>db.query('select public.get_organization_field_complexes($1)',[SPORT]),/No access/i);
    await expectReject(()=>db.query('select public.set_organization_field_complex($1,$2,$3)',[SPORT,LOC1,'Other Complex']),/No access/i);
    await db.close();console.log('PASS field complex settings reject another organization');
  }
  {
    const db=await fresh();const a=await assignment(db,GAME1,OFF1);
    await db.query('update public.assignments set payment_status=$1 where id=$2',['paid',a.id]);
    await expectReject(()=>move(db,a.id),/payroll/i);
    assert.equal((await db.query('select count(*)::int n from public.assignments where id=$1',[a.id])).rows[0].n,1);
    await db.close();console.log('PASS paid assignment rejected without partial move');
  }
  {
    const db=await fresh();const a=await assignment(db,GAME1,OFF1);
    await db.exec(`delete from public.official_level_eligibility where official_id='${OFF1}'`);
    await expectReject(()=>move(db,a.id),/Eligibility override required/);
    assert.equal((await db.query('select count(*)::int n from public.assignments where id=$1',[a.id])).rows[0].n,1);
    await move(db,a.id,GAME2,'transfer',true,true);
    await db.close();console.log('PASS eligibility rejected, explicit override works');
  }
  {
    const db=await fresh();const a=await assignment(db,GAME1,OFF1);
    await db.query('insert into public.assignments(game_id,position_id,official_id,status) values($1,$2,$3,$4)',[GAME3,POS1,OFF1,'accepted']);
    await expectReject(()=>move(db,a.id),/overlapping assignment/i);
    assert.equal((await db.query('select count(*)::int n from public.assignments where id=$1',[a.id])).rows[0].n,1);
    await db.close();console.log('PASS overlap rejected without partial move');
  }
  {
    const db=await fresh();const a=await assignment(db,GAME1,OFF1);
    await db.query('insert into public.payroll_fee_corrections values($1)',[a.id]);
    await expectReject(()=>move(db,a.id),/payroll/i);
    assert.equal((await db.query('select count(*)::int n from public.assignments where id=$1',[a.id])).rows[0].n,1);
    await db.close();console.log('PASS payroll correction rejected without partial move');
  }
  {
    const db=await fresh();const a=await assignment(db,GAME1,OFF1);
    await db.query('insert into public.assignments(game_id,position_id,official_id,status) values($1,$2,$3,$4)',[GAME2,POS1,OFF2,'declined']);
    const result=(await move(db,a.id)).rows[0].result;
    assert.equal((await db.query('select count(*)::int n from public.assignments where game_id=$1',[GAME2])).rows[0].n,1);
    assert.equal((await db.query('select official_id from public.assignments where id=$1',[result.targetAssignmentId])).rows[0].official_id,OFF1);
    await db.close();console.log('PASS transfer into formerly declined position');
  }
})().catch((error)=>{console.error('FAIL',error);process.exitCode=1});
