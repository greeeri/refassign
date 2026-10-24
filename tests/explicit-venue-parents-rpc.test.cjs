const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { fixture, I, id, asUser, denied } = require('./support/league-security-fixture.cjs');

const sql = fs.readFileSync('supabase/explicit_venue_parents.sql', 'utf8');
assert.equal(fs.readFileSync('supabase/migrations/20261024180343_explicit_venue_parents.sql', 'utf8'), sql, 'migration must match reviewed standalone SQL');
const baseline = fs.readFileSync('supabase/migrations/20261022195617_scope_administrators_to_selected_leagues.sql', 'utf8');
const V = { a: id(100), b: id(101), hidden: id(102), unused: id(103) };
const parent = async (db, location = I.locationA) => (await db.query('select venue_id from public.locations where id=$1', [location])).rows[0]?.venue_id;
const setParent = (db, location, venue, expected) => db.query('select public.set_location_venue($1,$2,$3) venue_id', [location, venue, expected]);
const directory = async (db, league = I.a, org = I.org) => (await db.query('select * from public.get_assignment_venue_directory_v2($1,$2)', [org, league])).rows;

async function venueFixture() {
  const db = await fixture();
  await db.exec(`
    create table public.venues(id uuid primary key, name text not null, address text, city text, state text);
    alter table public.locations add column venue_id uuid references public.venues(id) on delete set null, add column field_complex text;
    alter table public.games add column archived_at timestamptz;
    insert into public.venues(id,name) values('${V.a}','Same name'),('${V.b}','Same name'),('${V.hidden}','Other organization'),('${V.unused}','No fields yet');
    update public.locations set venue_id=case id when '${I.locationA}' then '${V.a}'::uuid when '${I.locationB}' then '${V.b}'::uuid else '${V.hidden}'::uuid end;
    alter table public.venues enable row level security;
    grant select,insert,update,delete on public.venues to authenticated;
    create policy legacy_permissive on public.venues for all to authenticated using(true) with check(true);
    create policy "Shared catalog insert fence" on public.venues as restrictive for insert to authenticated with check(public.is_super_admin());
    create policy "Shared catalog update fence" on public.venues as restrictive for update to authenticated using(public.is_super_admin()) with check(public.is_super_admin());
    create policy "Shared catalog delete fence" on public.venues as restrictive for delete to authenticated using(public.is_super_admin());
  `);
  for (const name of ['Venue scope read fence', 'Scoped users read venues']) {
    await db.exec(baseline.match(new RegExp(`create policy "${name}"[\\s\\S]*?;`))[0]);
  }
  await db.exec(fs.readFileSync('supabase/assignment_venue_directory.sql', 'utf8'));
  return db;
}

test('explicit venue parent APIs retain existing identity and authorization', async t => {
  const db = await venueFixture();
  const policies = async () => (await db.query('select schemaname,tablename,policyname,roles,cmd,qual,with_check from pg_policies order by 1,2,3')).rows;
  const tableGrants = async () => (await db.query("select table_schema,table_name,grantee,privilege_type from information_schema.role_table_grants where table_schema='public' order by 1,2,3,4")).rows;
  const rowSnapshot = async () => (await db.query('select (select jsonb_agg(l order by id) from public.locations l) locations,(select jsonb_agg(g order by id) from public.games g) games,(select jsonb_agg(a order by id) from public.assignments a) assignments,(select jsonb_agg(o order by organization_id,location_id) from public.organization_locations o) links')).rows;
  try {
    const beforePolicies = await policies(), beforeGrants = await tableGrants(), beforeRows = await rowSnapshot();
    await db.exec(sql);
    await t.test('migration is additive and idempotent with no guessed mappings, RLS or grant changes', async () => {
      await db.exec(sql);
      assert.deepEqual(await policies(), beforePolicies);
      assert.deepEqual(await tableGrants(), beforeGrants);
      assert.deepEqual(await rowSnapshot(), beforeRows);
      const funcs = (await db.query("select proname,prosecdef,proconfig,has_function_privilege('anon',oid,'execute') anon from pg_proc where proname in ('get_location_venue_options','set_location_venue','get_assignment_venue_directory_v2') order by proname")).rows;
      assert.equal(funcs.length, 3);
      for (const fn of funcs) { assert.equal(fn.prosecdef, false); assert.equal(fn.anon, false); assert(fn.proconfig.includes('search_path=""')); }
    });
    await t.test('venue options expose only authorized parents, not unattached or other-organization venues', async () => {
      await asUser(db, I.admin, async () => assert.deepEqual((await db.query('select id from public.get_location_venue_options()')).rows.map(x => x.id), [V.a,V.b]));
      await asUser(db, I.owner, async () => assert.deepEqual((await db.query('select id from public.get_location_venue_options()')).rows.map(x => x.id).sort(), [V.a,V.b,V.hidden].sort()));
      await asUser(db, I.stranger, async () => assert.equal((await db.query('select * from public.get_location_venue_options()')).rows.length, 0));
      await asUser(db, null, async () => assert.equal((await db.query('select * from public.get_location_venue_options()')).rows.length, 0));
      await asUser(db, I.superadmin, async () => assert.equal((await db.query('select * from public.get_location_venue_options()')).rows.length, 4));
    });
    await t.test('owner can explicitly assign, change and clear a parent without changing field/game/assignment identity', async () => {
      await asUser(db, I.owner, async () => {
        const visibleBefore = await rowSnapshot();
        await setParent(db, I.locationA, V.b, V.a);
        assert.equal(await parent(db), V.b);
        await setParent(db, I.locationA, null, V.b);
        assert.equal(await parent(db), null);
        await setParent(db, I.locationA, V.b, null);
        const after = await rowSnapshot();
        assert.deepEqual(after[0].games, visibleBefore[0].games);
        assert.deepEqual(after[0].assignments, visibleBefore[0].assignments);
        assert.deepEqual(after[0].links, visibleBefore[0].links);
        assert.equal((await directory(db))[0].venue_id, V.b);
      });
      assert.deepEqual(await rowSnapshot(), beforeRows, 'test transaction rollback restores mappings');
    });
    await t.test('stale expected values fail, including a concurrent clear or assignment', async () => {
      await asUser(db, I.owner, async () => {
        await denied(db, 'select public.set_location_venue($1,$2,$3)', [I.locationA,V.b,null], /venue changed/i);
        await setParent(db, I.locationA, null, V.a);
        await denied(db, 'select public.set_location_venue($1,$2,$3)', [I.locationA,V.b,V.a], /venue changed/i);
        assert.equal(await parent(db), null);
      });
    });
    await t.test('restricted managers, viewers, strangers and unauthenticated callers cannot change a mapping', async () => {
      for (const user of [I.admin, I.mixed, I.viewer, I.stranger, null]) {
        await asUser(db, user, () => denied(db, 'select public.set_location_venue($1,$2,$3)', [I.locationA,V.b,V.a], /cannot change/i));
      }
      assert.equal(await parent(db), V.a);
    });
    await t.test('even an owner cannot attach an unreadable parent or create/edit venues', async () => {
      await asUser(db, I.owner, async () => {
        await denied(db, 'select public.set_location_venue($1,$2,$3)', [I.locationA,V.unused,V.a], /outside your access/i);
        await denied(db, 'select public.set_location_venue($1,$2,$3)', [I.locationA,id(999),V.a], /outside your access/i);
        await denied(db, 'insert into public.venues(id,name) values($1,$2)', [id(999),'Not allowed']);
        assert.equal((await db.query('update public.venues set name=$1 where id=$2 returning id', ['Changed',V.a])).rows.length, 0);
        assert.equal(await parent(db), V.a);
      });
      await asUser(db, I.superadmin, async () => {
        await setParent(db, I.locationA, V.unused, V.a);
        assert.equal(await parent(db), V.unused);
      });
    });
    await t.test('v2 retains selected league scope and stable venue IDs despite identical names or rename', async () => {
      await asUser(db, I.owner, async () => {
        assert.deepEqual((await directory(db)).map(x => [x.location_id,x.venue_id,x.venue_name]), [[I.locationA,V.a,'Same name']]);
        assert.deepEqual((await directory(db,I.b)).map(x => [x.location_id,x.venue_id]), [[I.locationB,V.b]]);
        assert.deepEqual(await directory(db,I.c), []);
        assert.deepEqual(await directory(db,null,I.otherOrg), []);
      });
      await asUser(db, I.admin, async () => {
        assert.deepEqual((await directory(db,null)).map(x => x.location_id), [I.locationA]);
        assert.deepEqual(await directory(db,I.b), []);
      }, `update public.locations set venue_id='${V.a}' where id='${I.locationB}'`);
      await asUser(db, I.superadmin, async () => {
        await db.query('update public.venues set name=$1 where id=$2', ['Renamed',V.a]);
        const row = (await directory(db))[0];
        assert.equal(row.venue_id,V.a); assert.equal(row.venue_name,'Renamed');
      });
    });
    await t.test('v2 leaves unassigned fields selectable and keeps legacy complex metadata unchanged', async () => {
      await asUser(db, I.owner, async () => {
        await setParent(db,I.locationA,null,V.a);
        const row = (await directory(db))[0];
        assert.equal(row.venue_id,null); assert.equal(row.venue_name,null); assert.equal(row.field_complex,'same complex');
        assert.deepEqual((await db.query('select * from public.get_assignment_venue_directory($1,$2)', [I.org,I.a])).rows, [{location_id:I.locationA,name:'A',field_complex:'same complex'}]);
      });
    });
    await t.test('indexes support parent lookup and organization/league schedule projection', async () => {
      const indexes = (await db.query("select indexname,indexdef from pg_indexes where indexname in ('locations_venue_id_id_idx','games_assignment_venue_directory_idx') order by indexname")).rows;
      assert.equal(indexes.length,2);
      assert.match(indexes[0].indexdef,/organization_id, league_id, location_id/);
      assert.match(indexes[0].indexdef,/archived_at IS NULL/);
      assert.match(indexes[1].indexdef,/venue_id, id/);
      // This tiny fixture naturally favors sequential scans. Forcing them off
      // verifies index eligibility, not a production performance benchmark.
      await db.exec('begin; set local enable_seqscan=off');
      try {
        const fields = await db.query('explain (format json) select id from public.locations where venue_id=$1', [V.a]);
        const games = await db.query('explain (format json) select distinct location_id from public.games where organization_id=$1 and league_id=$2 and archived_at is null and location_id is not null', [I.org,I.a]);
        assert.match(JSON.stringify(fields.rows), /locations_venue_id_id_idx/);
        assert.match(JSON.stringify(games.rows), /games_assignment_venue_directory_idx/);
      } finally { await db.exec('rollback'); }

    });
  } finally { await db.close(); }
});
