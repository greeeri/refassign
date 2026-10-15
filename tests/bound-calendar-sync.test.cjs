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
 const org='00000000-0000-4000-8000-000000000001',league='00000000-0000-4000-8000-000000000002';
 await db.exec(`insert into organizations values('${org}');insert into leagues values('${league}','High School');insert into sports(name) values('Soccer');`);
 const feed=(await db.query(`insert into calendar_sync_feeds(organization_id,league_id,name,source_event_id,url,enabled,bootstrapped) values($1,$2,'Test','feed1','https://gobound.com/ia/conferences/test/calendar/ical/feed1',true,true) returning id`,[org,league])).rows[0].id;
 const event=(uid,date,level='Varsity Boys',location='Alpha High School')=>({uid,facts:{date,time:'13:00:00',end:date+'T14:00:00',location,matchup:'Beta vs Alpha',level,status:'CONFIRMED'},starts_at:date+'T18:00:00.000Z',duration:60,time_tbd:false,field_tbd:!location,sex:'Boys',source_level:'Varsity',home_school:'Alpha',away_school:'Beta',issues:[]});
 await db.exec('set role service_role');
 let events=[event('ha','2027-04-01'),event('hb','2027-04-02')];
 async function claim(){await db.query('update calendar_sync_feeds set last_attempt_at=null where id=$1',[feed]);return(await db.query('select claim_bound_calendar_feed($1,true) f',[feed])).rows[0].f;}
 async function apply(items){const c=await claim();assert.ok(c);return(await db.query('select apply_bound_calendar_feed($1,$2,$3::jsonb,$4) r',[feed,c.run_id,JSON.stringify(items),'hash'])).rows[0].r;}
 let r=await apply(events);assert.equal(r.added,2);assert.equal(r.updated,0);
 const game=(await db.query("select * from games where source_match_id='ha'")).rows[0];
 await db.query('insert into assignments(game_id,status,fee) values($1,$2,$3)',[game.id,'confirmed',75]);
 const assignment=(await db.query('select * from assignments')).rows[0];
 r=await apply(events);assert.equal(r.added+r.updated+r.removed,0);assert.equal((await db.query('select count(*)::int n from games')).rows[0].n,2);
 events[0]=event('ha','2027-04-08','JV Boys');r=await apply(events);assert.equal(r.updated,1);assert.equal(r.assigned_games_affected,1);
 assert.deepEqual((await db.query('select * from assignments')).rows[0],assignment,'sync must preserve assignment response, fee and token');
 assert.equal((await db.query('select calendar_needs_review from games where id=$1',[game.id])).rows[0].calendar_needs_review,true);
 await db.query("update games set starts_at='2027-04-10 19:00Z' where id=$1",[game.id]);
 events[0]=event('ha','2027-04-09','JV Boys');await apply(events);
 assert.equal(new Date((await db.query('select starts_at from games where id=$1',[game.id])).rows[0].starts_at).toISOString(),'2027-04-10T19:00:00.000Z');
 events[0]=event('ha','2027-04-11','JV Boys');await apply(events);
 assert.equal(new Date((await db.query('select starts_at from games where id=$1',[game.id])).rows[0].starts_at).toISOString(),'2027-04-10T19:00:00.000Z','manual override must stay protected on subsequent runs');
 // Missing details and malformed duration are held; no actual time/venue invented.
 const missing=event('hc','2027-04-12');missing.facts.time=null;missing.time_tbd=true;missing.facts.location='';missing.field_tbd=true;missing.duration=-30;missing.issues=['Start and venue missing; malformed duration.'];
 events.push(missing);r=await apply(events);assert.equal(r.held,1);
 const held=(await db.query("select * from games where source_match_id='hc'")).rows[0];assert.equal(held.status,'suspended');assert.equal(held.location_id,null);assert.equal(held.time_tbd,true);assert.equal(held.duration_minutes,110);
 // Exact replay is quiet; source cancellation cannot release a user's hold.
 events[2].facts.status='CANCELLED';await apply(events);assert.equal((await db.query('select status from games where id=$1',[held.id])).rows[0].status,'suspended');
 // A new overlap is retained on a database-protected hold.
 events.push(event('hd','2027-04-02'));r=await apply(events);assert.equal(r.held,1);
 const conflict=(await db.query("select * from games where source_match_id='hd'")).rows[0];assert.equal(conflict.venue_conflict_hold,true);
 await assert.rejects(db.query("update games set status='active' where id=$1",[conflict.id]),/conflict/);
 // Removal holds the record, not its assignments. A >25% drop rolls back the entire feed.
 r=await apply(events.filter(e=>e.uid!=='hd'));assert.equal(r.removed,1);assert.equal((await db.query('select count(*)::int n from games')).rows[0].n,4);
 const c=await claim();await assert.rejects(db.query('select apply_bound_calendar_feed($1,$2,$3::jsonb,$4)',[feed,c.run_id,'[]','bad']),/25%/);
 assert.equal((await db.query('select event_count from calendar_sync_feeds where id=$1',[feed])).rows[0].event_count,3);
 await db.query('select fail_bound_calendar_feed($1,$2,$3)',[feed,c.run_id,'Retrieval failed']);
 assert.equal((await db.query('select failure_count from calendar_sync_feeds where id=$1',[feed])).rows[0].failure_count,1);
 // An overlapping subscription links the same source UID without creating a second game.
 const feed2=(await db.query(`insert into calendar_sync_feeds(organization_id,league_id,name,source_event_id,url,enabled,bootstrapped) values($1,$2,'Second','feed2','https://gobound.com/ia/conferences/test/calendar/ical/feed2',true,true) returning id`,[org,league])).rows[0].id;
 let second=(await db.query('select claim_bound_calendar_feed($1,true) f',[feed2])).rows[0].f;
 r=(await db.query('select apply_bound_calendar_feed($1,$2,$3::jsonb,$4) r',[feed2,second.run_id,JSON.stringify([events[0]]),'hash'])).rows[0].r;assert.equal(r.added,0);
 assert.equal((await db.query('select count(*)::int n from games')).rows[0].n,4);
 await db.query('update calendar_sync_feeds set last_attempt_at=null where id=$1',[feed2]);
 second=(await db.query('select claim_bound_calendar_feed($1,true) f',[feed2])).rows[0].f;
 r=(await db.query('select apply_bound_calendar_feed($1,$2,$3::jsonb,$4) r',[feed2,second.run_id,JSON.stringify([event('ha','2027-05-01')]),'hash2'])).rows[0].r;assert.equal(r.updated,1);
 assert.equal((await db.query("select count(*)::int n from calendar_sync_changes where kind='source_conflict'")).rows[0].n,1);
 // Fractional durations and ambiguous provisional tiers are never active imports.
 const fractional=event('he','2027-06-01');fractional.duration=59.5;const ambiguous=event('hf','2027-06-02','JV2 Boys');ambiguous.source_level='JVR-A';
 await apply([...events.filter(e=>e.uid!=='hd'),fractional,ambiguous]);
 assert.equal((await db.query("select count(*)::int n from games where source_match_id in('he','hf') and status='suspended'")).rows[0].n,2);
 await apply([...events.filter(e=>e.uid!=='hd'),fractional,ambiguous,event('hg','2027-07-01'),event('hh','2027-07-01')]);
 assert.equal((await db.query("select count(*)::int n from games where source_match_id in('hg','hh') and status='suspended' and venue_conflict_hold")).rows[0].n,2);
 // A feed lease prevents overlapping workers. Anonymous clients cannot invoke writes.
 const lease=await claim();assert.ok(lease);assert.equal((await db.query('select claim_bound_calendar_feed($1,true) f',[feed])).rows[0].f,null);
 await db.exec('set role anon');await assert.rejects(db.query('select claim_bound_calendar_feed($1,true)',[feed]),/permission denied/);
 await db.close();console.log('Bound sync integration checks passed: replay, updates, manual overrides, assignments/fees, source cancellations, missing details, conflicts, removals, rollback, retries, leases and permissions.');
})().catch(e=>{console.error(e);process.exitCode=1});
