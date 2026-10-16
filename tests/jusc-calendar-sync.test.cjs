const {PGlite}=require('@electric-sql/pglite');
const fs=require('node:fs');const assert=require('node:assert/strict');
(async()=>{
 const db=new PGlite();
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema private;
 create table organizations(id uuid primary key);create table leagues(id uuid primary key,name text);create table sports(id uuid primary key default gen_random_uuid(),name text);
 create table levels(id uuid primary key default gen_random_uuid(),name text,officials_needed int,active boolean default true);
 create table teams(id uuid primary key default gen_random_uuid(),organization_id uuid,sport_id uuid,level_id uuid,name text,gender text,source_system text,source_team_id text,active boolean default true);
 create table locations(id uuid primary key default gen_random_uuid(),name text,source_system text,source_event_id text,active boolean default true);
 create table bill_to_accounts(id uuid primary key default gen_random_uuid(),organization_id uuid,name text);
 create table organization_teams(organization_id uuid,team_id uuid,primary key(organization_id,team_id));
 create table organization_levels(organization_id uuid,level_id uuid,primary key(organization_id,level_id));
 create table organization_locations(organization_id uuid,location_id uuid,primary key(organization_id,location_id));
 create table private.organization_league_team_settings(organization_id uuid,league_id uuid,team_ids uuid[]);
 create table private.organization_league_level_settings(organization_id uuid,league_id uuid,level_ids uuid[]);
 create table games(id uuid primary key default gen_random_uuid(),organization_id uuid,league_id uuid,sport_id uuid,level_id uuid,level text,location_id uuid,home_team_id uuid,away_team_id uuid,
 starts_at timestamptz not null,time_tbd boolean not null default false,field_tbd boolean not null default false,duration_minutes int not null default 110,officials_needed int not null default 3,status text not null default 'active',venue_conflict_hold boolean not null default false,
 bill_to_id uuid,game_number text unique,source_system text,source_event_id text,source_match_id text,source_synced_at timestamptz,calendar_needs_review boolean default false,calendar_reviewed_at timestamptz,calendar_reviewed_by uuid,notes text,archived_at timestamptz);
 create table assignments(id uuid primary key default gen_random_uuid(),game_id uuid,status text,fee numeric,response_token uuid default gen_random_uuid());
 create function public.reset_assignments_after_game_update() returns trigger language plpgsql as $$ begin update assignments set status='proposed' where game_id=new.id;return new;end $$;
 create function private.split_game_fees_on_crew_reduction() returns trigger language plpgsql as $$ begin update assignments set fee=0 where game_id=new.id;return new;end $$;
 create trigger reset_assignment after update on games for each row execute function public.reset_assignments_after_game_update();
 create trigger fee_split after update of officials_needed on games for each row execute function private.split_game_fees_on_crew_reduction();
 create table schedule_sync_tokens(token uuid default gen_random_uuid(),expires_at timestamptz default now()+interval '10 minutes',used_at timestamptz);
 grant usage on schema public to service_role;grant all on all tables in schema public to service_role;
 `);
 await db.exec(fs.readFileSync('supabase/migrations/20261014161527_venue_conflict_hold_activation_guard.sql','utf8'));
 await db.exec(fs.readFileSync(process.env.BOUND_MIGRATION||'supabase/migrations/20261015201557_bound_calendar_native_sync.sql','utf8'));
 await db.exec(fs.readFileSync('supabase/migrations/20261015201816_bound_sync_ambiguous_duration_holds.sql','utf8'));
 await db.exec(fs.readFileSync('supabase/migrations/20261015202102_bound_sync_source_overlap_holds.sql','utf8'));
 const org='3bef75a5-be0f-41e3-a03d-853c62ccedf0',league='7ebefc42-8821-4c73-8954-b99ac9765781';
 await db.exec(`insert into organizations values('${org}');insert into leagues values('${league}','JUSC');insert into sports(name) values('Soccer');`);
 await db.exec(fs.readFileSync('supabase/migrations/20261016130000_jusc_nightly_sync.sql','utf8'));
 const feed=(await db.query("update calendar_sync_feeds set enabled=true where source_system='playmetrics' returning id")).rows[0].id;
 await db.exec('set role service_role');
 const event=(id,date)=>({uid:id,facts:{date,time:'13:00:00',end:null,location:'Field 1',matchup:'JUSC G9A vs Visitors',level:'',status:'CONFIRMED'},starts_at:date+'T18:00:00Z',duration:60,crew:3,time_tbd:false,field_tbd:false,home_school:'JUSC G9A',away_school:'Visitors',sex:'',issues:['Verify new game details.']});
 async function apply(events){await db.query('update calendar_sync_feeds set last_attempt_at=null where id=$1',[feed]);const c=(await db.query('select claim_bound_calendar_feed($1,true) f',[feed])).rows[0].f;assert.ok(c);return(await db.query('select apply_jusc_calendar_feed($1,$2,$3::jsonb,$4) r',[feed,c.run_id,JSON.stringify(events),'hash'])).rows[0].r;}
 const events=[event('5011111','2027-04-01'),event('5011112','2027-04-02'),event('5011113','2027-04-03'),event('5011114','2027-04-04')];
 let r=await apply(events);assert.equal(r.added,4);assert.equal(r.held,4);
 const g=(await db.query("select * from games where source_match_id='5011111'")).rows[0];
 await db.query('insert into assignments(game_id,status,fee) values($1,$2,$3)',[g.id,'confirmed',75]);
 const a=(await db.query('select * from assignments')).rows[0];
 r=await apply(events);assert.equal(r.added+r.updated+r.removed,0);
 events[0]=event('5011111','2027-04-10');r=await apply(events);assert.equal(r.updated,1);
 assert.deepEqual((await db.query('select * from assignments')).rows[0],a);
 assert.equal((await db.query('select calendar_needs_review from games where id=$1',[g.id])).rows[0].calendar_needs_review,true);
 await db.query("update games set starts_at='2027-04-12 19:00Z' where id=$1",[g.id]);
 events[0]=event('5011111','2027-04-11');await apply(events);
 assert.equal(new Date((await db.query('select starts_at from games where id=$1',[g.id])).rows[0].starts_at).toISOString(),'2027-04-12T19:00:00.000Z');
 r=await apply(events.slice(0,3));assert.equal(r.removed,1);
 assert.equal((await db.query('select count(*)::int n from games')).rows[0].n,4);
 await db.exec('reset role');
 for(const [now,want] of [['2026-10-16T12:00:00Z','2026-10-16T23:30:00.000Z'],['2026-12-16T12:00:00Z','2026-12-17T00:30:00.000Z'],['2026-11-01T01:00:00Z','2026-11-02T00:30:00.000Z']]){
 const value=(await db.query('select private.next_jusc_calendar_check($1::timestamptz) t',[now])).rows[0].t;assert.equal(new Date(value).toISOString(),want);
 }
 await db.exec('set role anon');await assert.rejects(db.query('select apply_jusc_calendar_feed($1,$2,$3::jsonb,$4)',[feed,g.id,'[]','bad']),/permission denied/);
 await db.close();console.log('JUSC sync: replay, holds, changes, crew preservation, manual overrides, removals, DST scheduling and permissions passed.');
})().catch(e=>{console.error(e);process.exit(1)});
