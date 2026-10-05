const { PGlite } = require('@electric-sql/pglite');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const ids = Array.from({length: 6}, (_, i) => `00000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`);
const [org, league, otherLeague, hs, club, stranger] = ids;
(async () => {
 const db = new PGlite();
 await db.exec(`
 create role anon; create role authenticated; create role service_role;
 create schema auth; create schema private;
 create function auth.uid() returns uuid language sql as $$select '${org}'::uuid$$;
 create function public.is_super_admin() returns boolean language sql as $$select false$$;
 create function private.can_access_organization(uuid) returns boolean language sql as $$select $1='${org}'::uuid$$;
 create function private.can_access_organization_league(uuid,uuid,uuid) returns boolean language sql as $$select $1='${org}'::uuid$$;
 create function private.can_manage_organization_league_settings(uuid,uuid) returns boolean language sql as $$select $1='${org}'::uuid and $2='${league}'::uuid$$;
 create table organizations(id uuid primary key);
 create table leagues(id uuid primary key);
 create table teams(id uuid primary key,active boolean default true);
 create table organization_teams(organization_id uuid,team_id uuid,active boolean default true);
 create table games(id serial primary key,organization_id uuid,league_id uuid,home_team_id uuid,away_team_id uuid,notes text);
 insert into organizations values ('${org}'),('${stranger}');
 insert into leagues values ('${league}'),('${otherLeague}');
 insert into teams(id) values ('${hs}'),('${club}');
 insert into organization_teams(organization_id,team_id) values ('${org}','${hs}'),('${org}','${club}');
 `);
 await db.exec(fs.readFileSync('supabase/migrations/20261005221351_league_team_selection.sql','utf8'));
 const save = (o,l,ls) => db.query('select public.save_organization_league_teams($1,$2,$3::uuid[])',[o,l,ls]);
 // Before configuring, both kinds of teams remain valid.
 await db.query('insert into games(organization_id,league_id,home_team_id) values ($1,$2,$3)',[org,league,club]);
 await save(org,league,[hs,hs]);
 const config = await db.query('select public.get_organization_league_teams($1) as config',[org]);
 assert.deepEqual(config.rows[0].config,[{league_id:league,team_ids:[hs]}]);
 await assert.rejects(db.query('insert into games(organization_id,league_id,home_team_id) values ($1,$2,$3)',[org,league,club]), /not selected/);
 await db.query('insert into games(organization_id,league_id,home_team_id) values ($1,$2,$3)',[org,league,hs]);
 await db.query('insert into games(organization_id,league_id,home_team_id) values ($1,$2,$3)',[org,otherLeague,club]);
 // Existing historical games retain their team, even in an import updating all columns.
 await db.query('update games set home_team_id=home_team_id,notes=$1 where id=1',['updated']);
 await assert.rejects(save(stranger,league,[hs]), /only leagues assigned/);
 await assert.rejects(save(org,otherLeague,[hs]), /only leagues assigned/);
 await assert.rejects(save(org,league,[stranger]), /active teams/);
 await assert.rejects(db.query('select public.get_organization_league_teams($1)',[stranger]), /Not authorized/);
 await save(org,league,[]);
 await assert.rejects(db.query('insert into games(organization_id,league_id,home_team_id) values ($1,$2,$3)',[org,league,hs]), /not selected/);
 await assert.rejects(db.query('insert into games(organization_id,league_id,away_team_id) values ($1,$2,$3)',[org,league,club]), /Away team/);
 await db.exec('set role anon');
 await assert.rejects(db.query('select public.get_organization_league_teams($1)',[org]), /permission denied/);
 await db.close();
 console.log('League teams: saving, deduplication, isolation, import validation, empty selection, historical editing and permissions passed.');
})().catch(error => {console.error(error);process.exit(1)});
