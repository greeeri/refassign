const {PGlite}=require('@electric-sql/pglite');
const fs=require('node:fs');const assert=require('node:assert/strict');
(async()=>{
 const db=new PGlite();
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema private;
 create schema auth;create table auth.users(id uuid primary key);
 insert into auth.users values('00000000-0000-4000-8000-000000000099');
 create function auth.uid() returns uuid language sql as $$ select '00000000-0000-4000-8000-000000000099'::uuid $$;
 create function private.can_manage_organization_league(uuid,uuid,uuid) returns boolean language sql as $$ select current_setting('test.denied',true) is distinct from 'on' and $2::text is distinct from current_setting('test.denied_league',true) $$;
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
 create table audit_history(organization_id uuid,entity_type text,entity_id uuid,game_id uuid,action text,actor_user_id uuid,summary text,old_data jsonb,new_data jsonb);
 create table assignments(id uuid primary key default gen_random_uuid(),game_id uuid,status text,fee numeric,response_token uuid default gen_random_uuid());
 create function public.reset_assignments_after_game_update() returns trigger language plpgsql as $$ begin update public.assignments set status='proposed' where game_id=new.id;return new;end $$;
 create function private.split_game_fees_on_crew_reduction() returns trigger language plpgsql as $$ begin update public.assignments set fee=0 where game_id=new.id;return new;end $$;
 create trigger reset_assignment after update on games for each row execute function public.reset_assignments_after_game_update();
 create trigger fee_split after update of officials_needed on games for each row execute function private.split_game_fees_on_crew_reduction();
 create table schedule_sync_tokens(token uuid default gen_random_uuid(),expires_at timestamptz default now()+interval '10 minutes',used_at timestamptz);
 grant usage on schema public to service_role;grant all on all tables in schema public to service_role;
 `);
 await db.exec(fs.readFileSync('supabase/migrations/20261014161527_venue_conflict_hold_activation_guard.sql','utf8'));
 await db.exec(fs.readFileSync('supabase/migrations/20261014171329_calendar_game_review_confirmation.sql','utf8'));
 await db.exec('grant execute on function public.confirm_calendar_game_review(uuid[]) to service_role;grant usage on schema auth to service_role');
 await db.exec(fs.readFileSync(process.env.BOUND_MIGRATION||'supabase/migrations/20261015201557_bound_calendar_native_sync.sql','utf8'));
 await db.exec(fs.readFileSync('supabase/migrations/20261015201816_bound_sync_ambiguous_duration_holds.sql','utf8'));
 await db.exec(fs.readFileSync('supabase/migrations/20261015202102_bound_sync_source_overlap_holds.sql','utf8'));
 await db.exec(fs.readFileSync('supabase/migrations/20261018220000_bound_status_hold_rechecks.sql','utf8'));
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
 // Exact replay is quiet; source cancellation remains canceled even when previously held.
 events[2].facts.status='CANCELLED';await apply(events);assert.equal((await db.query('select status from games where id=$1',[held.id])).rows[0].status,'canceled');
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
 // Acknowledgment is not release, and an unchanged check never reopens it.
 const preReviewAssignment=(await db.query('select * from assignments')).rows[0];
 const pairIds=(await db.query("select id from games where source_match_id in('hg','hh') order by source_match_id")).rows.map(x=>x.id);
 await db.query('select confirm_calendar_game_review($1::uuid[])',[pairIds]);
 const beforeAck=(await db.query('select status,venue_conflict_hold,calendar_needs_review,calendar_reviewed_at,calendar_reviewed_by from games where id=$1',[pairIds[0]])).rows[0];
 assert.equal(beforeAck.status,'suspended');assert.equal(beforeAck.calendar_needs_review,false);assert.equal(beforeAck.venue_conflict_hold,true);
 const repeatAck=(await db.query('select confirm_calendar_game_review($1::uuid[]) r',[pairIds])).rows[0].r;assert.equal(repeatAck.reviewed,0);
 let full=[...events.filter(e=>e.uid!=='hd'),fractional,ambiguous,event('hg','2027-07-01'),event('hh','2027-07-01')];
 r=await apply(full);assert.equal(r.holds_rechecked,0);
 assert.deepEqual((await db.query('select status,venue_conflict_hold,calendar_needs_review,calendar_reviewed_at,calendar_reviewed_by from games where id=$1',[pairIds[0]])).rows[0],beforeAck);
 // Moving only the other source event resolves this unchanged event's blockers.
 full=full.map(e=>e.uid==='hh'?event('hh','2027-07-02'):e);await apply(full);
 let resolved=(await db.query('select * from games where id=$1',[pairIds[0]])).rows[0];
 assert.equal(resolved.bound_source_status,'CONFIRMED');assert.equal(resolved.status,'suspended');assert.equal(resolved.venue_conflict_hold,true);
 assert.deepEqual(resolved.bound_hold_reasons,[]);assert.equal(resolved.bound_hold_resolution_candidate,true);assert.equal(resolved.calendar_needs_review,true);
 await db.query('select confirm_calendar_game_review($1::uuid[])',[pairIds]);
 // A DB-only overlap appears without any source edit, including on HTTP 304.
 const manualId=(await db.query("insert into games(organization_id,league_id,starts_at,duration_minutes,location_id,game_number,status,venue_conflict_hold) select organization_id,league_id,starts_at,60,location_id,'MANUAL-OVERLAP','suspended',true from games where id=$1 returning id",[pairIds[0]])).rows[0].id;
 const check304=async()=>{const c=await claim();return(await db.query('select apply_bound_calendar_feed($1,$2,null,$3) r',[feed,c.run_id,'hash'])).rows[0].r;};
 await check304();resolved=(await db.query('select * from games where id=$1',[pairIds[0]])).rows[0];
 assert.ok(resolved.bound_hold_reasons.includes('database_overlap'));assert.equal(resolved.bound_hold_resolution_candidate,false);
 await assert.rejects(db.query("update games set status='active' where id=$1",[pairIds[0]]),/Bound source conflict/);
 await db.query("update games set status='canceled' where id=$1",[manualId]);await check304();
 resolved=(await db.query('select * from games where id=$1',[pairIds[0]])).rows[0];assert.equal(resolved.bound_hold_resolution_candidate,true);assert.equal(resolved.status,'suspended');
 // Review/rechecks cannot mutate assignments; cancellation overrides a hold.
 assert.deepEqual((await db.query('select * from assignments')).rows[0],preReviewAssignment);
 const canceled=(await db.query('select * from games where id=$1',[held.id])).rows[0];assert.equal(canceled.bound_source_status,'CANCELLED');assert.equal(canceled.status,'canceled');assert.equal(canceled.bound_hold_resolution_candidate,false);
 await assert.rejects(db.query("update games set status='active' where id=$1",[held.id]),/Bound source conflict/);
 // Unknown source status is not silently labeled active.
 const unknown=event('hi','2027-08-01');delete unknown.facts.status;full.push(unknown);await apply(full);
 const unknownGame=(await db.query("select * from games where source_match_id='hi'")).rows[0];assert.equal(unknownGame.bound_source_status,'UNKNOWN');assert.equal(unknownGame.status,'suspended');assert.ok(unknownGame.bound_hold_reasons.includes('source_status_unknown'));
 // A legacy 304 cannot auto-release holds or bulk-hold previously active games.
 const activeBefore=(await db.query('select status from games where id=$1',[game.id])).rows[0].status;
 await db.query('update calendar_sync_events set normalized_event=null where feed_id=$1',[feed]);
 const legacyClaim=await claim();assert.equal(legacyClaim.needs_full_fetch,true);
 await db.query('select apply_bound_calendar_feed($1,$2,null,$3)',[feed,legacyClaim.run_id,'hash']);
 assert.equal((await db.query('select status from games where id=$1',[game.id])).rows[0].status,activeBefore);
 assert.equal((await db.query('select bound_hold_resolution_candidate from games where id=$1',[pairIds[0]])).rows[0].bound_hold_resolution_candidate,false);
 await apply(full);
 const fetchedClaim=await claim();assert.equal(fetchedClaim.needs_full_fetch,false);
 await db.query('select apply_bound_calendar_feed($1,$2,null,$3)',[feed,fetchedClaim.run_id,'hash']);
 // Legacy canceled peers never require a second pass to resolve another hold.
 await db.query("update games set starts_at='2027-07-01 18:00Z',status='suspended' where id=$1",[pairIds[1]]);
 await db.query("update calendar_sync_events set source_facts=jsonb_set(source_facts,'{status}','\"CANCELLED\"') where game_id=$1",[pairIds[1]]);
 await check304();
 assert.equal((await db.query('select bound_hold_resolution_candidate from games where id=$1',[pairIds[0]])).rows[0].bound_hold_resolution_candidate,true);
 assert.equal((await db.query('select status from games where id=$1',[pairIds[1]])).rows[0].status,'canceled');
 // A canceled source peer does not cause an otherwise valid new event hold.
 const cancelledPeer=event('hj','2027-09-01');cancelledPeer.facts.status='CANCELLED';
 full.push(event('hk','2027-09-01'),cancelledPeer);await apply(full);
 assert.equal((await db.query("select status from games where source_match_id='hk'")).rows[0].status,'active');
 // Review + release is atomic, authorized, stale-safe and resource-guarded.
 let releaseGame=(await db.query('select * from games where id=$1',[pairIds[0]])).rows[0];
 const release=()=>db.query('select review_and_release_bound_game($1,$2) r',[releaseGame.id,releaseGame.bound_hold_checked_at]);
 await db.exec('set role authenticated');
 await db.query("select set_config('test.denied','on',false)");
 await assert.rejects(release(),/cannot review and release/);
 await db.query("select set_config('test.denied','off',false)");
 await db.query("select set_config('test.denied_league',$1,false)",[league]);await assert.rejects(release(),/cannot review and release/);
 await db.query("select set_config('test.denied_league','',false)");
 await assert.rejects(db.query('select review_and_release_bound_game($1,$2)',[releaseGame.id,'2020-01-01T00:00:00Z']),/changed since/);
 await db.exec('set role service_role');
 await db.query("update games set notes=concat(notes,' manual hold reason') where id=$1",[releaseGame.id]);
 await db.exec('set role authenticated');await assert.rejects(release(),/changed since/);
 await db.exec('set role service_role');await db.query('update games set notes=$2 where id=$1',[releaseGame.id,releaseGame.notes]);
 await db.query("update games set status='suspended' where id=$1",[manualId]);
 await db.exec('set role authenticated');await assert.rejects(release(),/current resource overlap/);
 await db.exec('set role service_role');
 assert.equal((await db.query('select calendar_needs_review from games where id=$1',[releaseGame.id])).rows[0].calendar_needs_review,true,'failed release must not acknowledge');
 assert.equal((await db.query("select count(*)::int n from audit_history where action='bound_review_release'")).rows[0].n,0);
 await db.query("update games set status='canceled' where id=$1",[manualId]);
 const originalTeam=(await db.query('select name from teams where id=$1',[releaseGame.home_team_id])).rows[0].name;
 await db.query("update teams set name='Home TBD' where id=$1",[releaseGame.home_team_id]);await db.exec('set role authenticated');await assert.rejects(release(),/Confirm the game details/);await db.exec('set role service_role');
 await db.query('update teams set name=$2 where id=$1',[releaseGame.home_team_id,originalTeam]);
 const assignmentBeforeRelease=(await db.query('select * from assignments')).rows[0];
 await db.exec('set role authenticated');
 let released=(await release()).rows[0].r;assert.equal(released.outcome,'released');assert.equal(released.status,'active');assert.equal(released.reviewed,true);
 assert.equal((await release()).rows[0].r.outcome,'already_released');
 await db.exec('set role service_role');
 const afterRelease=(await db.query('select * from games where id=$1',[releaseGame.id])).rows[0];assert.equal(afterRelease.venue_conflict_hold,false);assert.equal(afterRelease.calendar_needs_review,false);
 assert.equal((await db.query("select count(*)::int n from audit_history where action='bound_review_release'")).rows[0].n,1);
 assert.deepEqual((await db.query('select * from assignments')).rows[0],assignmentBeforeRelease);
 // Canceled review stays canceled and never clears its operational hold flag.
 releaseGame=(await db.query('select * from games where id=$1',[held.id])).rows[0];
 await db.exec('set role authenticated');released=(await release()).rows[0].r;assert.equal(released.outcome,'canceled_reviewed');assert.equal(released.status,'canceled');assert.equal(released.released,false);assert.equal((await release()).rows[0].r.reviewed,false);
 await db.exec('set role service_role');
 await check304();assert.equal((await db.query('select status from games where id=$1',[pairIds[0]])).rows[0].status,'active','unchanged sync must not reinstate released hold');
 // Manually suspended Bound records without resource-hold ownership are ineligible.
 await db.query("update games set status='suspended' where source_match_id='hk'");await check304();
 releaseGame=(await db.query("select * from games where source_match_id='hk'")).rows[0];assert.equal(releaseGame.bound_hold_resolution_candidate,false);
 await db.exec('set role authenticated');await assert.rejects(release(),/not eligible/);await db.exec('set role service_role');
 // A feed lease prevents overlapping workers. Anonymous clients cannot invoke writes.
 const lease=await claim();assert.ok(lease);assert.equal((await db.query('select claim_bound_calendar_feed($1,true) f',[feed])).rows[0].f,null);
 await db.exec('set role anon');await assert.rejects(db.query('select claim_bound_calendar_feed($1,true)',[feed]),/permission denied/);
 await db.close();console.log('Bound sync integration checks passed: replay, updates, manual overrides, assignments/fees, source cancellations, missing details, conflicts, removals, rollback, retries, leases and permissions.');
})().catch(e=>{console.error(e);process.exitCode=1});
