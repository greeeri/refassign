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
 await db.exec(fs.readFileSync('supabase/migrations/20261018130000_jusc_team_level_fallback.sql','utf8'));
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
 // Regression: a unique uploaded roster wins over the legacy blank import.
 await db.exec('reset role');
 const sport=(await db.query("select id from sports where name='Soccer'")).rows[0].id;
 const level=(await db.query("insert into levels(name,officials_needed) values('14u girls rec',3) returning id")).rows[0].id;
 const lowerLevel=(await db.query("insert into levels(name,officials_needed) values('12u girls rec',3) returning id")).rows[0].id;
 const upload=(await db.query('insert into teams(organization_id,sport_id,level_id,name) values($1,$2,$3,$4) returning id',[org,sport,level,'JUSC G9A'])).rows[0].id;
 const teamCount=(await db.query('select count(*)::int n from teams')).rows[0].n;
 const assignmentsBefore=(await db.query('select * from assignments')).rows;
 await db.exec('set role service_role');
 r=await apply(events.slice(0,3));
 const filled=(await db.query("select * from games where source_match_id='5011112'")).rows[0];
 assert.equal(filled.level_id,level,'existing blank game resolves unchanged source matchup');
 assert.equal(filled.officials_needed,3);assert.equal(filled.duration_minutes,60);
 assert.equal(filled.status,'suspended');assert.equal(filled.calendar_needs_review,true);
 assert.deepEqual((await db.query('select * from assignments')).rows,assignmentsBefore);
 assert.equal((await db.query('select count(*)::int n from teams')).rows[0].n,teamCount);
 r=await apply(events.slice(0,3));assert.equal(r.updated,0,'fallback replay is idempotent');
 // Existing explicit game level wins, even when both uploaded rosters are higher.
 await db.query('update games set level_id=$1,level=$2 where id=$3',[lowerLevel,'12u girls rec',filled.id]);
 await apply(events.slice(0,3));
 assert.equal((await db.query('select level_id from games where id=$1',[filled.id])).rows[0].level_id,lowerLevel);
 await db.exec('reset role');
 const resolve=async(name)=> (await db.query('select * from private.resolve_jusc_team($1,$2,$3,$4)',[org,league,sport,name])).rows[0];
 assert.deepEqual(await resolve('  jusc g9a  '),{team_id:upload,level_id:level,ambiguous:false});
 await db.query("select set_config('refassign.bound_league',$1,false)",[league]);
 assert.equal((await db.query('select private.jusc_team($1,$2,$3,$4,$5) id',[org,sport,lowerLevel,'JUSC G9A',''])).rows[0].id,upload,'game level must not filter roster lookup');
 assert.equal((await db.query('select count(*)::int n from teams')).rows[0].n,teamCount);
 // New games reuse the uploaded roster ID without copying the game level to
 // the opponent. A level does not automatically release the review hold.
 await db.exec('set role service_role');
 const fresh=event('5011115','2027-05-01');
 await apply([...events.slice(0,3),fresh]);
 const newGame=(await db.query("select * from games where source_match_id='5011115'")).rows[0];
 assert.equal(newGame.home_team_id,upload);assert.equal(newGame.level_id,level);
 assert.equal(newGame.status,'suspended');assert.equal(newGame.calendar_needs_review,true);
 assert.equal((await db.query('select level_id from teams where id=$1',[newGame.away_team_id])).rows[0].level_id,null);
 await db.exec('reset role');
 // Multiple uploaded identities are unresolved, even if their levels agree.
 const duplicate=(await db.query('insert into teams(organization_id,sport_id,level_id,name) values($1,$2,$3,$4) returning id',[org,sport,level,'JUSC G9A'])).rows[0].id;
 assert.equal((await resolve('JUSC G9A')).ambiguous,true);
 assert.equal((await db.query('select * from private.resolve_jusc_team($1,$2,$3,$4,$5)',[org,league,sport,'JUSC G9A',upload])).rows[0].team_id,upload,'saved leveled roster identity disambiguates the name');
 assert.equal((await db.query('select private.jusc_team($1,$2,null,$3,$4) id',[org,sport,'JUSC G9A',''])).rows[0].id,null);
 await db.query('delete from teams where id=$1',[duplicate]);
 // Explicit league selection, organization, sport and inactive rows are respected.
 await db.query('insert into private.organization_league_team_settings values($1,$2,$3)',[org,league,[]]);
 assert.equal((await resolve('JUSC G9A')).team_id,null);
 assert.equal((await db.query('select private.jusc_team($1,$2,null,$3,$4) id',[org,sport,'JUSC G9A',''])).rows[0].id,null,'excluded team is not recreated');
 await db.query('delete from private.organization_league_team_settings where organization_id=$1 and league_id=$2',[org,league]);
 await db.query('insert into teams(organization_id,sport_id,level_id,name) values(gen_random_uuid(),$1,$2,$3),($4,gen_random_uuid(),$2,$3)',[sport,level,'Outside',org]);
 assert.equal((await resolve('Outside')).team_id,null);
 await db.query('update teams set active=false where id=$1',[upload]);
 assert.notEqual((await resolve('JUSC G9A')).team_id,upload);
 await db.query('update teams set active=true where id=$1',[upload]);
 // Oldest-age ordering is numeric and independent of side, UUID and crew.
 for(const [label,want] of [['U14',14],['14u girls rec',14],['u-12',12],['U 9',9],['U19 elite',19],['Varsity',null],['U12/U14',null],['2014u',null],['U14 division 1',null],['U00',null]]) {
  assert.equal((await db.query('select private.jusc_level_age($1) age',[label])).rows[0].age,want,label);
 }
 const unknown=(await db.query("insert into levels(name,officials_needed) values('Varsity',3) returning id")).rows[0].id;
 const tied=(await db.query("insert into levels(name,officials_needed) values('U14 premier',3) returning id")).rows[0].id;
 const nine=(await db.query("insert into levels(name,officials_needed) values('9u rec',1) returning id")).rows[0].id;
 const ten=(await db.query("insert into levels(name,officials_needed) values('U10 rec',1) returning id")).rows[0].id;
 const cases=[[lowerLevel,level,level],[level,lowerLevel,level],[level,level,level],[null,level,level],[null,null,null],[unknown,level,null],[tied,level,null],[nine,ten,ten],[ten,nine,ten]];
 const all=[...events.slice(0,3),fresh];
 await db.query('update games set level_id=null,level=null where id=$1',[newGame.id]);
 await db.query('delete from calendar_sync_events where feed_id=$1 and uid=$2',[feed,fresh.uid]);
 await db.exec('set role service_role');await apply(all);await db.exec('reset role');
 assert.equal((await db.query('select level_id from games where id=$1',[newGame.id])).rows[0].level_id,level,'existing blank game without a baseline still receives fallback');

 for(let i=0;i<cases.length;i++) {
  const [homeLevel,awayLevel,expected]=cases[i];
  const home='Case home '+i,away='Case away '+i;
  const homeId=(await db.query('insert into teams(organization_id,sport_id,level_id,name) values($1,$2,$3,$4) returning id',[org,sport,homeLevel,home])).rows[0].id;
  const awayId=(await db.query('insert into teams(organization_id,sport_id,level_id,name) values($1,$2,$3,$4) returning id',[org,sport,awayLevel,away])).rows[0].id;
  const item=event(String(5011200+i),'2027-06-'+String(i+1).padStart(2,'0'));
  item.home_school=home;item.away_school=away;item.facts.matchup=home+' vs '+away;all.push(item);
  await db.exec('set role service_role');await apply(all);await db.exec('reset role');
  const saved=(await db.query('select * from games where source_match_id=$1',[item.uid])).rows[0];
  assert.equal(saved.level_id,expected,'oldest-age case '+i);
  assert.equal(saved.home_team_id,homeId);assert.equal(saved.away_team_id,awayId);
  assert.equal(saved.status,'suspended');assert.equal(saved.calendar_needs_review,true);
  assert.equal((await db.query('select level_id from teams where id=$1',[homeId])).rows[0].level_id,homeLevel);
 }
 // Ambiguous uploads never create another blank duplicate or leak a level.
 await db.query('insert into teams(organization_id,sport_id,level_id,name) values($1,$2,$3,$5),($1,$2,$4,$5)',[org,sport,level,lowerLevel,'Ambiguous home']);
 const beforeAmbiguous=(await db.query('select count(*)::int n from teams')).rows[0].n;
 const ambiguousEvent=event('5011300','2027-07-01');ambiguousEvent.home_school='Ambiguous home';ambiguousEvent.away_school='JUSC G9A';ambiguousEvent.facts.matchup='Ambiguous home vs JUSC G9A';all.push(ambiguousEvent);
 await db.exec('set role service_role');await apply(all);await db.exec('reset role');
 const ambiguousGame=(await db.query('select * from games where source_match_id=$1',[ambiguousEvent.uid])).rows[0];
 assert.equal(ambiguousGame.home_team_id,null);assert.equal(ambiguousGame.level_id,null);
 assert.equal(ambiguousGame.status,'suspended');assert.equal(ambiguousGame.calendar_needs_review,true);
 assert.equal((await db.query('select count(*)::int n from teams')).rows[0].n,beforeAmbiguous);
 // Retain the production guard that catches overlaps before the other event
 // has been inserted; both events must be held, not only the second one.
 const overlaps=[event('5011301','2027-07-02'),event('5011302','2027-07-02')];all.push(...overlaps);
 await db.exec('set role service_role');await apply(all);await db.exec('reset role');
 const overlapGames=(await db.query("select venue_conflict_hold from games where source_match_id in ('5011301','5011302')")).rows;
 assert.equal(overlapGames.length,2);assert.ok(overlapGames.every(g=>g.venue_conflict_hold));
 for(const [now,want] of [['2026-10-16T12:00:00Z','2026-10-16T23:30:00.000Z'],['2026-12-16T12:00:00Z','2026-12-17T00:30:00.000Z'],['2026-11-01T01:00:00Z','2026-11-02T00:30:00.000Z']]){
 const value=(await db.query('select private.next_jusc_calendar_check($1::timestamptz) t',[now])).rows[0].t;assert.equal(new Date(value).toISOString(),want);
 }
 await db.exec('set role anon');await assert.rejects(db.query('select apply_jusc_calendar_feed($1,$2,$3::jsonb,$4)',[feed,g.id,'[]','bad']),/permission denied/);
 await db.close();console.log('JUSC sync: oldest-age fallback, scoped roster resolution, ambiguity holds, replay, crew preservation, manual overrides, removals, DST and permissions passed.');
})().catch(e=>{console.error(e);process.exit(1)});
