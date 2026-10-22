// A real PostgreSQL service is required; PGlite's single connection cannot
// prove transaction interleavings. CI supplies an isolated localhost service.
const test = require('node:test');
const assert = require('node:assert/strict');
const { resourceFixture, I, id, read } = require('./support/game-resource-fixture.cjs');
const connectionString = process.env.REFASSIGN_TEST_POSTGRES_URL;

test('real concurrent resource and official writes across scoped organizations', { skip: !connectionString }, async t => {
  const { Client } = require('pg');
  const url = new URL(connectionString);
  assert(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname), 'Only an isolated localhost PostgreSQL fixture is allowed');
  const admin = new Client({ connectionString });
  await admin.connect();
  const database = `refassign_resource_test_${process.pid}_${Date.now()}`;
  let db, first, second;
  try {
    await admin.query(`create database "${database}"`);
    url.pathname = `/${database}`;
    const options = { connectionString: url.toString() };
    const client = new Client(options);
    await client.connect();
    db = await resourceFixture({ exec: sql => client.query(sql), query: (sql, args) => client.query(sql, args), close: () => client.end() });
    await db.exec(`
      insert into public.organization_memberships(organization_id,user_id,role) values('${I.otherOrg}','${I.stranger}','admin');
      insert into public.organization_member_league_access(organization_id,user_id,league_id,all_locations) values('${I.otherOrg}','${I.stranger}','${I.c}',true);
      insert into public.organization_locations(organization_id,location_id,active) values('${I.otherOrg}','${I.locationA}',true),('${I.otherOrg}','${I.locationB}',true);
      insert into public.organization_teams values('${I.otherOrg}','${I.teamA}',true);
      insert into private.organization_league_team_settings values('${I.otherOrg}','${I.c}',array['${I.teamA}'::uuid]);
      insert into public.organization_officials values('${I.otherOrg}','${I.officialA}',true);
      insert into public.official_league_eligibility values('${I.officialA}','${I.c}');
    `);
    first = new Client(options); second = new Client(options);
    await first.connect(); await second.connect();
    const pid = (await second.query('select pg_backend_pid() pid')).rows[0].pid;
    async function begin(connection, actor) {
      await connection.query('begin isolation level read committed');
      await connection.query("select set_config('request.jwt.claim.sub',$1,true)", [actor]);
      await connection.query('set local role authenticated');
      await connection.query("set local statement_timeout='8s'");
    }
    async function race(firstSql, firstArgs, secondSql, secondArgs, code) {
      await begin(first, I.admin); await begin(second, I.stranger);
      await first.query(firstSql, firstArgs);
      const pending = second.query(secondSql, secondArgs).then(result => ({ result }), error => ({ error }));
      let waiting = false;
      try {
        for (let attempt = 0; attempt < 100; attempt++) {
          const row = (await db.query('select wait_event from pg_stat_activity where pid=$1', [pid])).rows[0];
          if (row?.wait_event === 'advisory') { waiting = true; break; }
          await new Promise(resolve => setTimeout(resolve, 10));
        }
        assert(waiting, 'the second real transaction must wait on the resource lock before the first commits');
        await first.query('commit');
        const outcome = await pending;
        assert.equal(outcome.error?.code, code, 'the waiting transaction sees and rejects the committed overlap');
      } finally {
        await first.query('rollback'); await second.query('rollback');
        await pending;
      }
    }
    const insert = 'insert into public.games(id,organization_id,league_id,location_id,home_team_id,starts_at,duration_minutes,status) values($1,$2,$3,$4,$5,$6,90,$7)';
    await t.test('same canonical field across organizations commits only one game', async () => {
      await race(insert, [id(100), I.org, I.a, I.locationA, null, '2030-04-01 18:00Z', 'active'],
        insert, [id(101), I.otherOrg, I.c, I.locationA, null, '2030-04-01 18:30Z', 'active'], '23514');
      assert.equal((await db.query('select count(*)::int n from public.games where id=any($1::uuid[])', [[id(100), id(101)]])).rows[0].n, 1);
    });
    await t.test('same real team at different fields across organizations commits only one game', async () => {
      await race(insert, [id(110), I.org, I.a, I.locationA, I.teamA, '2030-04-02 18:00Z', 'active'],
        insert, [id(111), I.otherOrg, I.c, I.locationB, I.teamA, '2030-04-02 18:30Z', 'active'], '23514');
    });
    await t.test('concurrent rescheduling cannot move two games onto one field', async () => {
      await db.query(insert, [id(120), I.org, I.a, I.locationA, null, '2030-04-03 12:00Z', 'active']);
      await db.query(insert, [id(121), I.otherOrg, I.c, I.locationB, null, '2030-04-03 14:00Z', 'active']);
      const update = 'update public.games set starts_at=$1,location_id=$2 where id=$3';
      await race(update, ['2030-04-03 18:00Z', I.locationA, id(120)], update, ['2030-04-03 18:30Z', I.locationA, id(121)], '23514');
      assert.equal((await db.query('select location_id from public.games where id=$1', [id(121)])).rows[0].location_id, I.locationB);
    });
    await t.test('the existing global official lock still rejects a concurrent hidden-organization assignment', async () => {
      await db.exec(read('20260916124134_enforce_global_official_assignment_conflicts.sql'));
      await db.query(insert, [id(130), I.org, I.a, I.locationA, null, '2030-04-04 18:00Z', 'active']);
      await db.query(insert, [id(131), I.otherOrg, I.c, I.locationB, null, '2030-04-04 18:30Z', 'active']);
      const assign = "insert into public.assignments(id,game_id,official_id,status) values($1,$2,$3,'accepted')";
      await race(assign, [id(230), id(130), I.officialA], assign, [id(231), id(131), I.officialA], '23P01');
    });
  } finally {
    if (first) await first.end();
    if (second) await second.end();
    if (db) await db.close();
    await admin.query(`drop database if exists "${database}" with (force)`);
    await admin.end();
  }
});
