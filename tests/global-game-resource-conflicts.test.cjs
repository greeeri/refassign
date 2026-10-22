const test = require('node:test');
const assert = require('node:assert/strict');
const { resourceFixture, I, id, asUser, read } = require('./support/game-resource-fixture.cjs');
const changeTime = (db, time = '2027-04-01 18:30Z') => db.query('update public.games set starts_at=$1 where id=$2', [time, I.gameA]);
const rejectsConflict = (operation, kind = 'Venue') => assert.rejects(operation, error => {
  assert.equal(error.code, '23514');
  assert.match(error.message, new RegExp(kind));
  assert(!error.message.includes('SECRET-LEAGUE-B'), 'hidden game details stay private');
  return true;
});

test('negative control reproduces caller-visible guard failure with the actual scoped RLS', async () => {
  const db = await resourceFixture(undefined, false);
  try {
    await asUser(db, I.admin, async () => { await changeTime(db); });
    await asUser(db, I.owner, async () => { await assert.rejects(changeTime(db), /Venue conflict/); });
  } finally { await db.close(); }
});

test('scoped edits and inserts reject hidden-league venue conflicts without broadening reads', async () => {
  const db = await resourceFixture();
  try {
    await asUser(db, I.admin, async () => {
      assert.deepEqual((await db.query('select game_number from public.games')).rows, [{ game_number: 'VISIBLE-A' }]);
      await rejectsConflict(changeTime(db));
    });
    await asUser(db, I.admin, async () => {
      await rejectsConflict(db.query('insert into public.games(id,organization_id,league_id,location_id,starts_at,status) values($1,$2,$3,$4,$5,$6)',
        [id(100), I.org, I.a, I.locationA, '2027-04-01 18:30Z', 'active']));
    });
    await asUser(db, I.admin, async () => {
      assert.equal((await db.query('update public.games set notes=$1 where id=$2 returning id', ['not permitted', I.gameB])).rows.length, 0);
      assert.deepEqual((await db.query('select game_number from public.games')).rows, [{ game_number: 'VISIBLE-A' }]);
    });
  } finally { await db.close(); }
});

test('real-team conflicts remain global across leagues and organizations at different venues', async () => {
  const db = await resourceFixture();
  try {
    await db.query('update public.games set location_id=$1,home_team_id=$2 where id=$3', [I.locationB, I.teamA, I.gameB]);
    await asUser(db, I.admin, async () => { await rejectsConflict(changeTime(db), 'Team'); });
    await db.query('update public.games set organization_id=$1,league_id=$2 where id=$3', [I.otherOrg, I.c, I.gameB]);
    await asUser(db, I.admin, async () => { await rejectsConflict(changeTime(db), 'Team'); });
    await db.query('update public.games set home_team_id=null,location_id=$1 where id=$2', [I.locationA, I.gameB]);
    await asUser(db, I.admin, async () => { await rejectsConflict(changeTime(db)); });
  } finally { await db.close(); }
});

test('direct and supported status activation preserve an unresolved venue hold; resolution releases it', async () => {
  const db = await resourceFixture();
  try {
    await db.query("update public.games set starts_at='2027-04-01 18:30Z',status='suspended',venue_conflict_hold=true where id=$1", [I.gameA]);
    const before = (await db.query('select * from public.assignments where game_id=$1', [I.gameA])).rows;
    await asUser(db, I.admin, async () => { await rejectsConflict(db.query("update public.games set status='active' where id=$1", [I.gameA])); });
    await asUser(db, I.admin, async () => { await rejectsConflict(db.query("select public.set_game_status($1,'active')", [I.gameA])); });
    assert.deepEqual((await db.query('select status,venue_conflict_hold from public.games where id=$1', [I.gameA])).rows[0], { status: 'suspended', venue_conflict_hold: true });
    await asUser(db, I.admin, async () => {
      await db.query('update public.games set venue_conflict_hold=false where id=$1', [I.gameA]);
      assert.equal((await db.query('select venue_conflict_hold from public.games where id=$1', [I.gameA])).rows[0].venue_conflict_hold, true);
    });
    await asUser(db, I.admin, async () => {
      await db.query("update public.games set starts_at='2027-04-01 20:00Z' where id=$1", [I.gameA]);
      await db.query("select public.set_game_status($1,'active')", [I.gameA]);
      assert.deepEqual((await db.query('select status,venue_conflict_hold from public.games where id=$1', [I.gameA])).rows[0], { status: 'active', venue_conflict_hold: false });
      assert.deepEqual((await db.query('select * from public.assignments where game_id=$1', [I.gameA])).rows, before, 'IDs, responses, fees and assignments remain intact');
    });
  } finally { await db.close(); }
});

test('half-open duration boundaries, cancellations, review holds, and TBD placeholders retain their semantics', async () => {
  const db = await resourceFixture();
  try {
    await asUser(db, I.admin, async () => { await changeTime(db, '2027-04-01 19:30Z'); });
    await asUser(db, I.admin, async () => { await rejectsConflict(changeTime(db, '2027-04-01 19:29Z')); });
    for (const status of ['canceled', 'cancelled', 'rained_out', 'rain_out']) {
      await db.query('update public.games set status=$1 where id=$2', [status, I.gameB]);
      await asUser(db, I.admin, async () => { await changeTime(db); });
    }
    await db.query("update public.games set status='suspended' where id=$1", [I.gameB]);
    await asUser(db, I.admin, async () => { await rejectsConflict(changeTime(db)); });
    await db.query('update public.games set venue_conflict_hold=true where id=$1', [I.gameB]);
    await asUser(db, I.admin, async () => { await changeTime(db); });
    await db.query("update public.games set status='active',location_id=$1,home_team_id=$2 where id=$3", [I.locationB, I.teamA, I.gameB]);
    await db.query("update public.teams set source_system='refassign-placeholder',source_team_id='tbd' where id=$1", [I.teamA]);
    await asUser(db, I.admin, async () => { await changeTime(db); });
  } finally { await db.close(); }
});

test('global official conflicts remain enforced despite scoped visibility and private guard is not callable', async () => {
  const db = await resourceFixture();
  try {
    await db.query('update public.games set location_id=$1,home_team_id=null where id=$2', [I.locationB, I.gameB]);
    await db.query('update public.games set home_team_id=null where id=$1', [I.gameA]);
    await changeTime(db);
    await db.query('update public.assignments set official_id=$1 where id=$2', [I.officialA, I.assignmentB]);
    await db.exec(read('20260916124134_enforce_global_official_assignment_conflicts.sql'));
    await asUser(db, I.admin, async () => {
      await assert.rejects(db.query("update public.assignments set status='proposed' where id=$1", [I.assignmentA]), /Official is unavailable/);
    });
    const acl = (await db.query("select prosecdef,proconfig,has_function_privilege('authenticated',oid,'EXECUTE') as callable from pg_proc where oid='private.enforce_global_game_resource_conflict()'::regprocedure")).rows[0];
    assert.equal(acl.prosecdef, true);
    assert.equal(acl.callable, false);
    assert(acl.proconfig.includes('search_path=""'));
  } finally { await db.close(); }
});
