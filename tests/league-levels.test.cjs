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
 create table levels(id uuid primary key,active boolean default true);
 create table organization_levels(organization_id uuid,level_id uuid,active boolean default true);
 create table games(id serial primary key,organization_id uuid,league_id uuid,level_id uuid,notes text);
 insert into organizations values ('${org}'),('${stranger}');
 insert into leagues values ('${league}'),('${otherLeague}');
 insert into levels(id) values ('${hs}'),('${club}');
 insert into organization_levels(organization_id,level_id) values ('${org}','${hs}'),('${org}','${club}');
 `);
 await db.exec(fs.readFileSync('supabase/migrations/20261005204729_league_level_selection.sql','utf8'));
 const save = (o,l,ls) => db.query('select public.save_organization_league_levels($1,$2,$3::uuid[])',[o,l,ls]);
 // Before configuring, both kinds of levels remain valid.
 await db.query('insert into games(organization_id,league_id,level_id) values ($1,$2,$3)',[org,league,club]);
 await save(org,league,[hs,hs]);
 const config = await db.query('select public.get_organization_league_levels($1) as config',[org]);
 assert.deepEqual(config.rows[0].config,[{league_id:league,level_ids:[hs]}]);
 await assert.rejects(db.query('insert into games(organization_id,league_id,level_id) values ($1,$2,$3)',[org,league,club]), /not selected/);
 await db.query('insert into games(organization_id,league_id,level_id) values ($1,$2,$3)',[org,league,hs]);
 await db.query('insert into games(organization_id,league_id,level_id) values ($1,$2,$3)',[org,otherLeague,club]);
 // Existing historical games retain their level, even in an import updating all columns.
 await db.query('update games set level_id=level_id,notes=$1 where id=1',['updated']);
 await assert.rejects(save(stranger,league,[hs]), /only leagues assigned/);
 await assert.rejects(save(org,otherLeague,[hs]), /only leagues assigned/);
 await assert.rejects(save(org,league,[stranger]), /active levels/);
 await assert.rejects(db.query('select public.get_organization_league_levels($1)',[stranger]), /Not authorized/);
 await save(org,league,[]);
 await assert.rejects(db.query('insert into games(organization_id,league_id,level_id) values ($1,$2,$3)',[org,league,hs]), /not selected/);
 await db.exec('set role anon');
 await assert.rejects(db.query('select public.get_organization_league_levels($1)',[org]), /permission denied/);
 await db.close();
 console.log('League levels: saving, deduplication, isolation, import validation, empty selection, historical editing and permissions passed.');
})().catch(error => {console.error(error);process.exit(1)});
