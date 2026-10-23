const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { fixture, I, id, asUser } = require('./support/league-security-fixture.cjs');

const sql = fs.readFileSync('supabase/assignment_venue_directory.sql', 'utf8');
async function directory(db, league = null, org = I.org) {
  return (await db.query('select * from public.get_assignment_venue_directory($1, $2)', [org, league])).rows;
}
const locationIds = rows => rows.map(row => row.location_id);

test('assignment venue directory uses selected schedule and existing authorization', async t => {
  const db = await fixture();
  try {
    await db.exec(`
      alter table public.games add column archived_at timestamptz, add column venue_conflict_hold boolean default false;
      -- Match existing production lookup indexes; this test does not add them
      -- through the feature migration or change any production relation.
      create index games_organization_league_idx on public.games(organization_id,league_id,starts_at);
      create index games_location_id_idx on public.games(location_id) where location_id is not null;
      create index organization_locations_location_idx on public.organization_locations(location_id);
    `);
    const policySnapshot = async () => (await db.query("select schemaname,tablename,policyname,roles,cmd,qual,with_check from pg_policies order by schemaname,tablename,policyname")).rows;
    const tableGrants = async () => (await db.query("select table_schema,table_name,grantee,privilege_type from information_schema.role_table_grants where table_schema='public' order by table_name,grantee,privilege_type")).rows;
    const beforePolicies = await policySnapshot(), beforeGrants = await tableGrants();
    await db.exec(sql);

    await t.test('invoker RPC, empty search path, restricted execute, no changes to policies or table grants', async () => {
      const { rows: [fn] } = await db.query("select prosecdef,provolatile,proconfig,has_function_privilege('anon',p.oid,'execute') anonymous,has_function_privilege('authenticated',p.oid,'execute') authenticated,has_function_privilege('service_role',p.oid,'execute') service from pg_proc p where p.proname='get_assignment_venue_directory'");
      assert.equal(fn.prosecdef, false);
      assert.equal(fn.provolatile, 's');
      assert(fn.proconfig.includes('search_path=""'));
      assert.equal(fn.anonymous, false);
      assert.equal(fn.authenticated, true);
      assert.equal(fn.service, true);
      assert.deepEqual(await policySnapshot(), beforePolicies);
      assert.deepEqual(await tableGrants(), beforeGrants);
      await db.exec('begin; set local role anon');
      try { await assert.rejects(directory(db), /permission denied/); }
      finally { await db.exec('rollback'); }
    });

    await t.test('selected league excludes other leagues and unused siblings with the same complex name', async () => {
      await asUser(db, I.owner, async () => {
        assert.deepEqual(await directory(db, I.a), [{ location_id: I.locationA, name: 'A', field_complex: 'same complex' }]);
        assert.deepEqual(locationIds(await directory(db, I.b)), [I.locationB]);
        assert.deepEqual(locationIds(await directory(db)), [I.locationA, I.locationB]);
        assert.deepEqual(await directory(db, I.c), []);
        assert.deepEqual(await directory(db, null, I.otherOrg), []);
      });
    });

    await t.test('All Leagues is the authorized union, not owner-visible or personal-official-only fields', async () => {
      for (const user of [I.admin, I.mixed, I.viewer]) {
        await asUser(db, user, async () => {
          if (user === I.mixed) assert((await db.query('select id from public.games')).rows.some(row => row.id === I.gameOwnB));
          assert.deepEqual(locationIds(await directory(db)), [I.locationA]);
          assert.deepEqual(locationIds(await directory(db, I.a)), [I.locationA]);
          assert.deepEqual(await directory(db, I.b), []);
          assert.deepEqual(await directory(db, null, I.otherOrg), []);
        });
      }
    });

    await t.test('paired league/location grants cannot be mixed to reveal a denied field', async () => {
      await asUser(db, I.admin, async () => {
        assert.deepEqual(locationIds(await directory(db, I.a)), [I.locationA]);
        assert.deepEqual(locationIds(await directory(db, I.b)), [I.locationB]);
        assert.deepEqual(locationIds(await directory(db)), [I.locationA, I.locationB]);
      }, `
        update public.organization_member_league_access set all_locations=false,location_ids=array['${I.locationA}'::uuid] where user_id='${I.admin}';
        insert into public.organization_member_league_access(organization_id,user_id,league_id,all_locations,location_ids) values('${I.org}','${I.admin}','${I.b}',false,array['${I.locationB}'::uuid]);
        insert into public.games(id,organization_id,league_id,location_id) values('${id(100)}','${I.org}','${I.a}','${I.locationB}');
      `);
      await asUser(db, I.admin, async () => {
        assert.deepEqual(await directory(db), []);
      }, `update public.organization_member_league_access set all_locations=false,location_ids='{}' where user_id='${I.admin}'`);
    });

    await t.test('missing login, missing scope, missing organization and inactive coverage fail closed', async () => {
      for (const user of [null, I.empty, I.stranger]) await asUser(db, user, async () => assert.deepEqual(await directory(db), []));
      await asUser(db, I.owner, async () => assert.deepEqual(await directory(db, null, null), []));
      await asUser(db, I.admin, async () => assert.deepEqual(await directory(db), []), `update public.organization_league_coverage set active=false where organization_id='${I.org}'`);
      await asUser(db, I.admin, async () => assert.deepEqual(await directory(db), []), `delete from public.organization_member_league_access where user_id='${I.admin}'`);
    });

    await t.test('past, future, canceled and held games contribute fields; archived and TBD locations do not', async () => {
      await asUser(db, I.owner, async () => {
        const rows = await directory(db, I.a);
        assert.deepEqual(locationIds(rows), [I.locationA, I.locationB, I.locationC]);
        assert.equal(rows.length, 3, 'multiple games at one field are deduplicated');
      }, `
        update public.games set starts_at='2000-01-01',status='canceled' where id='${I.gameA}';
        insert into public.games(id,organization_id,league_id,location_id,starts_at,venue_conflict_hold) values
          ('${id(100)}','${I.org}','${I.a}','${I.locationB}','2099-01-01',true),
          ('${id(101)}','${I.org}','${I.a}','${I.locationC}','2099-01-01',false),
          ('${id(102)}','${I.org}','${I.a}',null,'2099-01-01',false),
          ('${id(103)}','${I.org}','${I.a}','${I.locationA}','2099-01-01',false);
        insert into public.locations(id,name) values('${id(104)}','Archived only');
        insert into public.games(id,organization_id,league_id,location_id,archived_at) values('${id(105)}','${I.org}','${I.a}','${id(104)}',now());
      `);
    });

    await t.test('historical fields retain existing read limits and inactive links never supply current complex metadata', async () => {
      for (const user of [I.owner, I.admin]) {
        await asUser(db, user, async () => {
          assert.deepEqual(locationIds(await directory(db, I.a)), [I.locationA]);
        }, `update public.locations set active=false where id='${I.locationA}'`);
        await asUser(db, user, async () => {
          assert.deepEqual(await directory(db, I.a), [], 'existing location RLS denies a disconnected name');
        }, `update public.organization_locations set active=false where location_id='${I.locationA}'`);
      }
      await asUser(db, I.superadmin, async () => {
        assert.deepEqual(await directory(db, I.a), [{ location_id: I.locationA, name: 'A', field_complex: null }]);
      }, `update public.locations set active=false where id='${I.locationA}'; update public.organization_locations set active=false where location_id='${I.locationA}'`);
    });

    await t.test('metadata is organization-local, exact-case and never inferred from location names', async () => {
      await asUser(db, I.owner, async () => {
        assert.equal((await directory(db, I.a))[0].field_complex, 'North');
        assert.equal((await directory(db, I.b))[0].field_complex, 'north');
      }, `update public.organization_locations set field_complex=case when location_id='${I.locationA}' then '  North  ' else 'north' end where organization_id='${I.org}'; insert into public.organization_locations values('${I.otherOrg}','${I.locationA}',true,'FOREIGN')`);
    });

    await t.test('fresh calls reflect archive, league move and scope revocation without server caching', async () => {
      await asUser(db, I.owner, async () => assert.deepEqual(await directory(db, I.a), []), `update public.games set archived_at=now() where id='${I.gameA}'`);
      await asUser(db, I.owner, async () => {
        assert.deepEqual(await directory(db, I.a), []);
        assert.deepEqual(locationIds(await directory(db, I.b)), [I.locationA, I.locationB]);
      }, `update public.games set league_id='${I.b}' where id='${I.gameA}'`);
    });

    await t.test('more than 1000 distinct fields page deterministically without clipping to the game-table page', async () => {
      await db.exec(`
        insert into public.locations(id,name) select ('00000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'Field '||n from generate_series(1000,2004) n;
        insert into public.organization_locations(organization_id,location_id,field_complex) select '${I.org}',id,'Large complex' from public.locations where id>='${id(1000)}';
        insert into public.games(id,organization_id,league_id,location_id) select ('00000000-0000-4000-8000-'||lpad((n+3000)::text,12,'0'))::uuid,'${I.org}','${I.a}',('00000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid from generate_series(1000,2004) n;
        analyze public.games; analyze public.locations; analyze public.organization_locations;
      `);
      await asUser(db, I.superadmin, async () => {
        const first = (await db.query('select * from public.get_assignment_venue_directory($1,$2) order by location_id limit 1000 offset 0', [I.org, I.a])).rows;
        const second = (await db.query('select * from public.get_assignment_venue_directory($1,$2) order by location_id limit 1000 offset 1000', [I.org, I.a])).rows;
        assert.equal(first.length, 1000);
        assert.equal(second.length, 6);
        const ids = locationIds([...first, ...second]);
        assert.equal(new Set(ids).size, 1006);
        assert.deepEqual(ids, [...ids].sort());
        assert.equal(ids.at(-1), id(2004));
      });
    });
  } finally { await db.close(); }
});
