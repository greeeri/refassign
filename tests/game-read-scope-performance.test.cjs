const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { fixture, I, id, asUser, functionSQL } = require('./support/league-security-fixture.cjs');

const optimization = fs.readFileSync('supabase/optimize_game_read_scope.sql', 'utf8');
test('batched game scope preserves canonical RLS and venue results under grant changes', async t => {
  const db = await fixture();
  try {
    await db.exec(`
      alter table public.games add column archived_at timestamptz;
      create table public.venues(id uuid primary key, name text);
      alter table public.locations add column venue_id uuid;
      grant select on public.venues to authenticated;
    `);
    await db.exec(functionSQL(fs.readFileSync('supabase/explicit_venue_parents.sql', 'utf8'), 'public.get_assignment_venue_directory_v2'));
    const scenarios = [];
    for (const user of [null, I.admin, I.mixed, I.empty, I.owner, I.superadmin, I.stranger, I.viewer]) {
      scenarios.push({ name: `baseline ${user}`, user, setup: '' });
    }
    const add = (name, user, setup) => scenarios.push({ name, user, setup });
    const restrict = `update public.organization_member_league_access set all_locations=false,location_ids=array['${I.locationA}'::uuid] where user_id='${I.admin}';`;
    add('restricted fields and missing/TBD location', I.admin, restrict + `insert into public.games(id,organization_id,league_id,location_id) values('${id(100)}','${I.org}','${I.a}',null),('${id(101)}','${I.org}','${I.a}','${I.locationB}');`);
    add('All fields includes missing/TBD location', I.admin, `insert into public.games(id,organization_id,league_id,location_id) values('${id(100)}','${I.org}','${I.a}',null);`);
    add('selected empty denies everything', I.admin, `update public.organization_member_league_access set all_locations=false,location_ids='{}' where user_id='${I.admin}';`);
    add('paired league/location grants', I.admin, restrict + `insert into public.organization_member_league_access values('${I.org}','${I.admin}','${I.b}',false,array['${I.locationB}'::uuid]); insert into public.games(id,organization_id,league_id,location_id) values('${id(100)}','${I.org}','${I.a}','${I.locationB}');`);
    add('inactive restricted location', I.admin, restrict + `update public.locations set active=false where id='${I.locationA}';`);
    add('inactive restricted connection', I.admin, restrict + `update public.organization_locations set active=false where location_id='${I.locationA}';`);
    add('inactive location with All remains historical', I.admin, `update public.locations set active=false;`);
    add('revoked membership', I.admin, `delete from public.organization_memberships where user_id='${I.admin}';`);
    add('revoked league grant', I.admin, `delete from public.organization_member_league_access where user_id='${I.admin}';`);
    add('inactive coverage', I.admin, `update public.organization_league_coverage set active=false;`);
    add('inactive coverage still permits personal assignment', I.mixed, `update public.organization_league_coverage set active=false;`);
    add('suspended organization', I.admin, `update public.organizations set operational=false;`);
    add('suspended owner', I.owner, `update public.organizations set operational=false;`);
    add('suspended personal assignment', I.mixed, `update public.organizations set operational=false;`);
    add('protected admin requires active coverage for unassigned games', I.superadmin, `update public.organizations set operational=false; update public.organization_league_coverage set active=false;`);
    add('mentor only membership', I.admin, `update public.organization_memberships set role='mentor' where user_id='${I.admin}';`);
    add('archived games excluded from directory only', I.admin, `update public.games set archived_at=now();`);
    add('unrelated personal game and inactive official', I.stranger, `update public.officials set auth_user_id='${I.stranger}',active=false where id='${I.officialB}';`);
    add('null league personal assignment', I.mixed, `update public.games set league_id=null,organization_id=null,location_id=null where id='${I.gameOwnB}';`);
    const snapshot = async () => ({
      games: (await db.query('select id from public.games order by id')).rows,
      venues: (await db.query('select * from public.get_assignment_venue_directory_v2($1,null)', [I.org])).rows,
    });
    const expected = [];
    for (const s of scenarios) expected.push(await asUser(db, s.user, snapshot, s.setup));
    const writes = (await db.query("select policyname,qual,with_check from pg_policies where tablename='games' and cmd<>'SELECT' order by policyname")).rows;
    await db.exec(optimization);
    for (let n = 0; n < scenarios.length; n++) {
      const s = scenarios[n];
      await t.test(s.name, async () => assert.deepEqual(await asUser(db, s.user, snapshot, s.setup), expected[n]));
    }
    await t.test('write policies and restrictive read fence remain intact', async () => {
      assert.deepEqual((await db.query("select policyname,qual,with_check from pg_policies where tablename='games' and cmd<>'SELECT' order by policyname")).rows, writes);
      assert.equal((await db.query("select permissive from pg_policies where tablename='games' and policyname='Location scope read fence'")).rows[0].permissive, 'RESTRICTIVE');
    });
    await t.test('private helper cannot accept another identity or run anonymously', async () => {
      const fn = (await db.query("select pronargs,proconfig,has_function_privilege('anon',oid,'execute') anon from pg_proc where proname='current_readable_game_ids'")).rows[0];
      assert.equal(fn.pronargs, 0); assert.equal(fn.anon, false); assert(fn.proconfig.includes('search_path=""'));
      assert.deepEqual(await asUser(db, null, async () => (await db.query('select * from private.current_readable_game_ids()')).rows), []);
    });
    await t.test('denied game remains unwritable after read optimization', async () => {
      await asUser(db, I.admin, async () => {
        assert.equal((await db.query('update public.games set notes=$1 where id=$2 returning id', ['denied',I.gameB])).rows.length, 0);
      });
    });
  } finally { await db.close(); }
});
