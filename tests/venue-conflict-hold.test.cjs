const { PGlite } = require('@electric-sql/pglite');
const fs = require('node:fs');
const assert = require('node:assert/strict');
(async () => {
  const db = new PGlite();
  await db.exec(`
    create table teams(id int primary key,source_system text,source_team_id text);
    create table locations(id int primary key,name text);
    create table games(id int primary key,game_number text,status text,starts_at timestamptz,duration_minutes int,home_team_id int,away_team_id int,location_id int,time_tbd boolean default false,field_tbd boolean default false);
    insert into teams values (1,'refassign-placeholder','tbd'),(2,'refassign-placeholder','tbd'),(3,null,null),(4,null,null);
    insert into locations values (1,'School Stadium'),(2,'Other Field');
  `);
  await db.exec(fs.readFileSync('supabase/migrations/20261014161527_venue_conflict_hold_activation_guard.sql','utf8'));
  await db.exec(`insert into games(id,game_number,status,starts_at,duration_minutes,home_team_id,away_team_id,location_id) values(1,'EXISTING','active','2027-04-01 18:00Z',60,1,2,1)`);
  await db.exec(`insert into games(id,game_number,status,starts_at,duration_minutes,home_team_id,away_team_id,location_id,venue_conflict_hold) values(2,'REVIEW','suspended','2027-04-01 18:30Z',60,1,2,1,true)`);
  await assert.rejects(db.exec(`update games set status='active' where id=2`),/Venue conflict at School Stadium with Game #EXISTING/);
  assert.equal((await db.query('select status from games where id=2')).rows[0].status,'suspended');
  await db.exec(`update games set venue_conflict_hold=false where id=2`);
  assert.equal((await db.query('select venue_conflict_hold from games where id=2')).rows[0].venue_conflict_hold,true);
  await assert.rejects(db.exec(`update games set status='active',field_tbd=true where id=2`),/confirmed location/);
  await assert.rejects(db.exec(`update games set status='active',time_tbd=true where id=2`),/confirmed location/);
  await db.exec(`update games set location_id=2 where id=2`);
  await db.exec(`update games set status='active' where id=2`);
  assert.equal((await db.query('select venue_conflict_hold from games where id=2')).rows[0].venue_conflict_hold,false);
  // Placeholder teams do not create false conflicts at separate fields.
  await db.exec(`insert into games(id,game_number,status,starts_at,duration_minutes,home_team_id,away_team_id,location_id) values(3,'CANCELLED','canceled','2027-04-01 18:00Z',60,3,4,1)`);
  await assert.rejects(db.exec(`insert into games(id,game_number,status,starts_at,duration_minutes,location_id) values(4,'OVERLAP','active','2027-04-01 18:30Z',60,1)`),/Venue conflict/);
  await db.exec(`insert into games(id,game_number,status,starts_at,duration_minutes,home_team_id,away_team_id,location_id) values(5,'REAL','active','2027-04-02 18:00Z',60,3,4,1)`);
  await assert.rejects(db.exec(`insert into games(id,game_number,status,starts_at,duration_minutes,home_team_id,location_id) values(6,'REAL OVERLAP','active','2027-04-02 18:30Z',60,3,2)`),/Team double-booking/);
  await db.exec(`insert into games(id,game_number,status,starts_at,duration_minutes,location_id) values(7,'ADJACENT','active','2027-04-02 19:00Z',60,1)`);
  await db.close();
  console.log('Venue conflict hold checks passed: blocked activation, retained hold, TBD guard, resolution, placeholders, real team conflicts, cancellations and adjacent games.');
})().catch(error => { console.error(error); process.exitCode=1; });
