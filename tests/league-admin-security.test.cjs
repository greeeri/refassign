const { PGlite } = require('@electric-sql/pglite');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const migration = fs.readFileSync(path.join(root, 'supabase/migrations/20261022195617_scope_administrators_to_selected_leagues.sql'), 'utf8');
const { fixture, I, id, asUser, value, ids, denied, functionSQL } = require('./support/league-security-fixture.cjs');

test('league administrator security predicates and real RLS deny-side regression',async t=>{
  const db=await fixture();
  try {
    await t.test('admin-only and combined roles are limited to explicit league A',async()=>{
      for(const user of [I.admin,I.mixed]) await asUser(db,user,async()=>{
        assert.equal(await value(db,'select private.can_manage_organization($1) value',[I.org]),false);
        assert.deepEqual(await value(db,'select private.organization_accessible_league_ids($1) value',[I.org]),[I.a]);
        for(const league of [I.a,I.b,I.c]) {
          assert.equal(await value(db,'select private.can_manage_organization_league($1,$2,auth.uid()) value',[I.org,league]),league===I.a);
        }
      });
    });
    await t.test('empty scopes and profile-only claims never imply all leagues',async()=>{
      for(const user of [I.empty,I.stranger]) await asUser(db,user,async()=>{
        assert.deepEqual(await value(db,'select private.organization_accessible_league_ids($1) value',[I.org]),[]);
        assert.equal(await value(db,'select private.can_manage_organization_league($1,$2,auth.uid()) value',[I.org,I.a]),false);
        assert.deepEqual(await ids(db,'games'),[]);
      });
    });
    await t.test('revocation, inactive coverage and inactive subscription immediately deny despite stale profile',async()=>{
      for(const setup of [
        `delete from public.organization_member_league_access where user_id='${I.admin}'`,
        `delete from public.organization_memberships where user_id='${I.admin}'`,
        `update public.organization_league_coverage set active=false where league_id='${I.a}'`,
        `update public.organizations set operational=false where id='${I.org}'`,
      ]) await asUser(db,I.admin,async()=>{
        assert.deepEqual(await value(db,'select private.organization_accessible_league_ids($1) value',[I.org]),[]);
        assert.deepEqual(await ids(db,'games'),[]);
      },setup);
    });
    await t.test('own official assignment outside admin scope remains read-only personal access',async()=>{
      await asUser(db,I.mixed,async()=>{
        assert.deepEqual(await ids(db,'games'),[I.gameA,I.gameOwnB]);
        assert.equal(await value(db,'select private.can_manage_game($1) value',[I.gameOwnB]),false);
        assert.equal((await db.query('update public.games set notes=$1 where id=$2 returning id',['forbidden',I.gameOwnB])).rows.length,0);
        assert.equal((await db.query('delete from public.assignments where id=$1 returning id',[I.assignmentOwnB])).rows.length,0);
      });
    });
    await t.test('owner with several roles and protected superadmin without memberships retain access',async()=>{
      for(const user of [I.owner,I.superadmin]) await asUser(db,user,async()=>{
        assert.equal(await value(db,'select private.can_manage_organization($1) value',[I.org]),true);
        assert.deepEqual(await value(db,'select private.organization_accessible_league_ids($1) value',[I.org]),[I.a,I.b]);
        assert.equal(await value(db,'select private.can_manage_game($1) value',[I.gameB]),true);
      });
      await asUser(db,I.owner,async()=>{
        assert.equal(await value(db,'select private.can_manage_organization_league($1,$2,auth.uid()) value',[I.otherOrg,I.c]),false);
      });
      await asUser(db,I.superadmin,async()=>{
        assert.equal(await value(db,'select private.can_manage_organization_league($1,$2,auth.uid()) value',[I.otherOrg,I.c]),true);
      });
    });
    await t.test('legacy permissive access cannot permit self-promotion or scope expansion',async()=>{
      await asUser(db,I.admin,async()=>{
        await denied(db,'insert into public.organization_memberships values($1,$2,$3)',[I.org,I.admin,'owner']);
        await denied(db,'insert into public.organization_member_league_access(organization_id,user_id,league_id) values($1,$2,$3)',[I.org,I.admin,I.b]);
        assert.equal((await db.query('update public.organization_memberships set role=$1 where organization_id=$2 and user_id=$3 returning role',['owner',I.org,I.admin])).rows.length,0);
        assert.equal((await db.query('delete from public.organization_member_league_access where user_id=$1 returning user_id',[I.admin])).rows.length,0);
        assert.equal((await db.query('update public.organization_user_access_profiles set league_ids=$1 where user_id=$2 returning user_id',[[I.a,I.b],I.admin])).rows.length,0);
        assert.equal((await db.query('update public.organization_league_coverage set active=false where league_id=$1 returning league_id',[I.a])).rows.length,0);
      });
    });
    await t.test('restrictive directory fences block unrelated rows despite broad legacy grants',async()=>{
      await asUser(db,I.admin,async()=>{
        assert.deepEqual(await ids(db,'leagues'),[I.a]);
        assert.deepEqual(await ids(db,'teams'),[I.teamA]);
        assert.deepEqual(await ids(db,'levels'),[I.levelA]);
        assert.deepEqual(await ids(db,'officials'),[I.officialA]);
        assert.equal((await db.query('update public.teams set name=$1 where id=$2 returning id',['forbidden',I.teamA])).rows.length,0);
        const directory=await value(db,'select private.get_game_directory_impl($1,null) value',[I.org]);
        assert.deepEqual(directory.teams.map(r=>r.id),[I.teamA]);
        assert.deepEqual(directory.levels.map(r=>r.id),[I.levelA]);
      });
    });
    await t.test('viewer gets scoped reads but cannot acquire administration',async()=>{
      await asUser(db,I.viewer,async()=>{
        assert.deepEqual(await ids(db,'games'),[I.gameA]);
        assert.equal(await value(db,'select private.can_manage_game($1) value',[I.gameA]),false);
        await denied(db,'insert into public.organization_memberships values($1,$2,$3)',[I.org,I.viewer,'admin']);
      });
    });
    await t.test('selected locations are exact IDs, never other fields sharing a complex or a missing location',async()=>{
      for(const user of [I.admin,I.mixed]) await asUser(db,user,async()=>{
        for(const [location,expected] of [[I.locationA,true],[I.locationB,false],[null,false]]) {
          assert.equal(await value(db,'select private.can_manage_organization_league_location($1,$2,$3,auth.uid()) value',[I.org,I.a,location]),expected);
        }
        assert.equal(await value(db,'select private.can_manage_organization_league_location($1,$2,$3,auth.uid()) value',[I.org,I.b,I.locationA]),false);
      },`update public.organization_member_league_access set all_locations=false,location_ids=array['${I.locationA}'::uuid] where user_id='${user}'`);
    });
    await t.test('selected empty locations and missing grants fail closed; All never adds a league',async()=>{
      await asUser(db,I.admin,async()=>{
        assert.equal(await value(db,'select private.can_manage_organization_league_location($1,$2,$3,auth.uid()) value',[I.org,I.a,I.locationA]),false);
        assert.deepEqual(await ids(db,'games'),[]);
      },`update public.organization_member_league_access set all_locations=false,location_ids='{}' where user_id='${I.admin}'`);
      await asUser(db,I.empty,async()=>{
        assert.equal(await value(db,'select private.can_manage_organization_league_location($1,$2,$3,auth.uid()) value',[I.org,I.a,I.locationA]),false);
      });
      await asUser(db,I.admin,async()=>{
        assert.equal(await value(db,'select private.can_manage_organization_league_location($1,$2,$3,auth.uid()) value',[I.org,I.a,I.locationB]),true);
        assert.equal(await value(db,'select private.can_manage_organization_league_location($1,$2,$3,auth.uid()) value',[I.org,I.b,I.locationB]),false);
      });
    });
    await t.test('location fences reject moving a game out of scope and atomic mixed-location inserts',async()=>{
      await asUser(db,I.admin,async()=>{
        await denied(db,'update public.games set location_id=$1 where id=$2',[I.locationB,I.gameA]);
        await denied(db,'update public.games set location_id=null where id=$1',[I.gameA]);
        await denied(db,'insert into public.games(id,organization_id,league_id,location_id) values($1,$2,$3,$4),($5,$2,$3,$6)',[id(100),I.org,I.a,I.locationA,id(101),I.locationB]);
        assert.equal((await db.query('select id from public.games where id in($1,$2)',[id(100),id(101)])).rows.length,0);
        assert.equal((await db.query('update public.organization_member_league_access set all_locations=true where user_id=$1 returning user_id',[I.admin])).rows.length,0);
      },`update public.organization_member_league_access set all_locations=false,location_ids=array['${I.locationA}'::uuid] where user_id='${I.admin}'`);
    });
    await t.test('personal assignment at an excluded location never revives manager UPDATE or DELETE authority',async()=>{
      await asUser(db,I.mixed,async()=>{
        assert.equal(await value(db,'select private.can_read_organization_game($1,auth.uid()) value',[id(102)]),true);
        assert.equal(await value(db,'select private.can_manage_game($1) value',[id(102)]),false);
        assert.equal((await db.query('update public.assignments set game_id=game_id where id=$1 returning id',[id(103)])).rows.length,0);
        assert.equal((await db.query('delete from public.assignments where id=$1 returning id',[id(103)])).rows.length,0);
        assert.equal((await db.query('update public.games set notes=$1 where id=$2 returning id',['forbidden',id(102)])).rows.length,0);
      },`
        update public.organization_member_league_access set all_locations=false,location_ids=array['${I.locationA}'::uuid] where user_id='${I.mixed}';
        insert into public.games(id,organization_id,league_id,location_id) values('${id(102)}','${I.org}','${I.a}','${I.locationB}');
        insert into public.assignments(id,game_id,official_id) values('${id(103)}','${id(102)}','${I.ownOfficial}');
      `);
    });
    await t.test('owner and protected superadmin retain location authority without per-league rows',async()=>{
      for(const user of [I.owner,I.superadmin]) await asUser(db,user,async()=>{
        for(const location of [I.locationA,I.locationB,null]) assert.equal(await value(db,
          'select private.can_manage_organization_league_location($1,$2,$3,auth.uid()) value',[I.org,I.a,location]),true);
      });
    });
    await t.test('location deactivation and league-wide settings do not bypass selected-only limits',async()=>{
      for(const setup of [
        `update public.organization_locations set active=false where location_id='${I.locationA}'`,
        `update public.locations set active=false where id='${I.locationA}'`,
      ]) await asUser(db,I.admin,async()=>{
        assert.equal(await value(db,'select private.can_manage_game($1) value',[I.gameA]),false);
      },`update public.organization_member_league_access set all_locations=false,location_ids=array['${I.locationA}'::uuid] where user_id='${I.admin}';${setup}`);
      await asUser(db,I.admin,async()=>{
        assert.equal(await value(db,'select private.can_manage_organization_league_settings($1,$2) value',[I.org,I.a]),false);
      },`update public.organization_member_league_access set all_locations=false,location_ids=array['${I.locationA}'::uuid] where user_id='${I.admin}'`);
    });
    await t.test('location normalization rejects foreign IDs, malformed flags and extra league metadata',async()=>{
      await asUser(db,I.owner,async()=>{
        const sql='select private.normalize_league_location_access($1,$2,$3::jsonb) value';
        const omitted=await value(db,sql,[I.org,[I.a],'[]']);
        assert.deepEqual(omitted,[{league_id:I.a,all_locations:false,location_ids:[]}]);
        const all=await value(db,sql,[I.org,[I.a],JSON.stringify([{league_id:I.a,all_locations:true,location_ids:[I.locationA]}])]);
        assert.deepEqual(all,[{league_id:I.a,all_locations:true,location_ids:[]}]);
        for(const input of [
          [{league_id:I.a,all_locations:false,location_ids:[id(999)]}],
          [{league_id:I.b,all_locations:true,location_ids:[]}],
          [{league_id:I.a,all_locations:'true',location_ids:[]}],
          [{league_id:I.a,all_locations:false,location_ids:[]},{league_id:I.a,all_locations:true,location_ids:[]}],
        ]) await denied(db,sql,[I.org,[I.a],JSON.stringify(input)],/location|league/i);
      });
    });
    await t.test('old-client role edits preserve restrictions and new leagues remain deny-by-default',async()=>{
      await asUser(db,I.owner,async()=>{
        await db.query('select public.set_organization_user_roles($1,$2,$3::text[],$4::text[],$5::uuid[])',[I.org,I.admin,['admin','assignor'],[],[I.a,I.b]]);
        const grants=(await db.query('select league_id,all_locations,location_ids from public.organization_member_league_access where user_id=$1 order by league_id',[I.admin])).rows;
        assert.deepEqual(grants,[{league_id:I.a,all_locations:false,location_ids:[I.locationA]},{league_id:I.b,all_locations:false,location_ids:[]}]);
      },`update public.organization_member_league_access set all_locations=false,location_ids=array['${I.locationA}'::uuid] where user_id='${I.admin}'`);
      await asUser(db,I.admin,async()=>{
        await denied(db,'select public.set_organization_user_roles($1,$2,$3::text[],$4::text[],$5::uuid[],$6::jsonb)',[I.org,I.admin,['admin'],[],[I.a,I.b],JSON.stringify([{league_id:I.a,all_locations:true,location_ids:[]},{league_id:I.b,all_locations:true,location_ids:[]}])]);
      });
    });
    await t.test('crew chat and game reports never trust legacy global roles',async()=>{
      await asUser(db,I.admin,async()=>{
        assert.deepEqual(await value(db,'select public.get_game_crew_chat($1) value',[I.gameA]),[]);
        await denied(db,'select public.get_game_crew_chat($1)',[I.gameB]);
        assert.equal(await value(db,'select public.can_access_game_report($1) value',[I.gameA]),true);
        assert.equal(await value(db,'select public.can_access_game_report($1) value',[I.gameB]),false);
      });
      await asUser(db,I.mixed,async()=>{
        assert.deepEqual(await value(db,'select public.get_game_crew_chat($1) value',[I.gameOwnB]),[]);
        assert.equal(await value(db,'select public.can_access_game_report($1) value',[I.gameOwnB]),true);
        assert.equal(await value(db,'select private.can_manage_game($1) value',[I.gameOwnB]),false);
      });
      await asUser(db,I.viewer,async()=>{
        assert.equal(await value(db,'select public.can_access_game_report($1) value',[I.gameA]),false);
      });
      await asUser(db,I.admin,async()=>{
        await denied(db,'select public.get_game_crew_chat($1)',[I.gameA]);
        assert.equal(await value(db,'select public.can_access_game_report($1) value',[I.gameA]),false);
      },`delete from public.organization_member_league_access where user_id='${I.admin}'`);
    });
    await t.test('global roster import definers reject scoped and combined admin roles before data validation',async()=>{
      const calls=[
        `select * from private.upsert_my_official_roster_row($1::uuid,${Array(18).fill('null').join(',')})`,
        `select * from private.upsert_my_referee_profile_row($1::uuid,${Array(33).fill('null').join(',')})`,
      ];
      for(const user of [I.admin,I.mixed]) await asUser(db,user,async()=>{
        for(const sql of calls) await denied(db,sql,[I.org],/cannot import|not authorized|owner/i);
      });
      await asUser(db,I.owner,async()=>{
        for(const sql of calls) await denied(db,sql,[I.org],/missing value/i);
      });
    });
    await t.test('overdue review validates every requested ID before writing and owner-gates shared blocks',async()=>{
      const setup=`update public.assignments set status='proposed',published_at=now()-interval '2 days',accept_by=now()-interval '1 day'`;
      await asUser(db,I.admin,async()=>{
        await denied(db,'select public.resolve_overdue_assignments($1,$2)',[[I.assignmentA,I.assignmentB],'keep'],/every requested assignment/i);
        assert.equal(await value(db,'select overdue_reviewed_at value from public.assignments where id=$1',[I.assignmentA]),null);
        await denied(db,'select public.resolve_overdue_assignments($1,$2)',[[I.assignmentA],'remove_and_block'],/owner/i);
        assert.deepEqual(await value(db,'select public.resolve_overdue_assignments($1,$2) value',[[I.assignmentA],'keep']),{assignments_resolved:1,blocks_created:0});
      },setup);
      await asUser(db,I.owner,async()=>{
        assert.deepEqual(await value(db,'select public.resolve_overdue_assignments($1,$2) value',[[I.assignmentA,I.assignmentB],'keep']),{assignments_resolved:2,blocks_created:0});
      },setup);
    });
    await t.test('linked-game mutation fails before any writes when one linked game is excluded',async()=>{
      await asUser(db,I.mixed,async()=>{
        assert.equal(await value(db,'select private.can_access_link_group($1,true) value',[id(301)]),false);
        await denied(db,'select public.assign_official_to_linked_games($1,$2,$3)',[I.gameA,id(399),I.officialA],/every linked game/i);
        assert.equal(await value(db,'select official_id value from public.assignments where id=$1',[I.assignmentA]),I.officialA);
      },`insert into public.game_link_groups values('${id(301)}','${I.org}','${I.mixed}');
        insert into public.game_link_members values('${id(301)}','${I.gameA}'),('${id(301)}','${I.gameOwnB}');`);
    });
    await t.test('financial reads require every game in the batch, with only personal item exceptions',async()=>{
      const setup=`
        update public.organization_member_league_access set all_locations=false,location_ids=array['${I.locationA}'::uuid] where user_id='${I.mixed}';
        insert into public.games(id,organization_id,league_id,location_id) values('${id(410)}','${I.org}','${I.a}','${I.locationB}');
        insert into public.payroll_batches values
          ('${id(401)}','${I.org}','${I.a}'),('${id(402)}','${I.org}','${I.a}'),('${id(403)}','${I.org}','${I.b}'),
          ('${id(404)}','${I.org}','${I.a}'),('${id(405)}','${I.org}','${I.a}'),('${id(406)}','${I.org}','${I.a}');
        insert into public.payroll_batch_items values
          ('${id(501)}','${id(401)}','${I.gameA}','${I.officialA}'),
          ('${id(502)}','${id(402)}','${I.gameA}','${I.officialA}'),
          ('${id(503)}','${id(402)}','${id(410)}','${I.ownOfficial}'),
          ('${id(504)}','${id(403)}','${I.gameOwnB}','${I.ownOfficial}'),
          ('${id(505)}','${id(405)}','${I.gameB}','${I.officialB}'),
          ('${id(506)}','${id(406)}','${id(999)}','${I.officialA}');
        insert into public.payroll_transfers values('${id(601)}','${id(401)}','${I.officialA}'),('${id(602)}','${id(403)}','${I.ownOfficial}');
        insert into public.payment_transactions values('${id(701)}','${I.org}','${id(401)}'),('${id(702)}','${I.org}','${id(403)}'),('${id(703)}','${I.org}',null);
        insert into public.payment_audit_events values('${id(801)}','${I.org}','${id(401)}'),('${id(802)}','${I.org}','${id(402)}');
        insert into public.league_payment_settings values('${id(901)}','${I.org}','${I.a}'),('${id(902)}','${I.org}','${I.b}');
        insert into public.transaction_fee_rules values('${id(911)}','${I.org}','${I.a}'),('${id(912)}','${I.org}','${I.b}');
      `;
      await asUser(db,I.mixed,async()=>{
        assert.deepEqual(await ids(db,'payroll_batches'),[id(401)]);
        assert.deepEqual(await ids(db,'payroll_batch_items'),[id(501),id(503),id(504)]);
        assert.deepEqual(await ids(db,'payroll_transfers'),[id(601),id(602)]);
        assert.deepEqual(await ids(db,'payment_transactions'),[id(701)]);
        assert.deepEqual(await ids(db,'payment_audit_events'),[id(801)]);
        assert.deepEqual(await ids(db,'league_payment_settings'),[id(901)]);
        assert.deepEqual(await ids(db,'transaction_fee_rules'),[id(911)]);
      },setup);
      await asUser(db,I.admin,async()=>{
        assert.deepEqual(await ids(db,'payroll_batches'),[id(401),id(402)]);
      },setup);
      await asUser(db,I.owner,async()=>{
        assert.equal((await ids(db,'payroll_batches')).length,6);
      },setup);
    });
    await t.test('coverage templates use canonical league grants and deny whole-league changes to selected-location users',async()=>{
      const setup=`insert into public.league_assignment_templates values('${id(921)}','${I.a}'),('${id(922)}','${I.b}');
        insert into public.league_assignment_template_positions values('${id(931)}','${id(921)}'),('${id(932)}','${id(922)}');`;
      await asUser(db,I.admin,async()=>{
        assert.deepEqual(await ids(db,'league_assignment_templates'),[id(921)]);
        assert.deepEqual(await ids(db,'league_assignment_template_positions'),[id(931)]);
        await denied(db,'update public.league_assignment_templates set coverage_id=$1 where id=$2',[I.b,id(921)]);
      },setup);
      await asUser(db,I.admin,async()=>{
        assert.deepEqual(await ids(db,'league_assignment_templates'),[id(921)]);
        assert.equal((await db.query('delete from public.league_assignment_templates where id=$1 returning id',[id(921)])).rows.length,0);
      },setup+`update public.organization_member_league_access set all_locations=false,location_ids=array['${I.locationA}'::uuid] where user_id='${I.admin}'`);
    });
    await t.test('guessed hidden shared IDs cannot be attached to an authorized game to reveal them',async()=>{
      await asUser(db,I.admin,async()=>{
        for(const [column,target] of [['home_team_id',I.teamB],['away_team_id',I.teamB],['level_id',I.levelB],['location_id',id(950)],['bill_to_id',id(951)]]) {
          await denied(db,`update public.games set ${column}=$1 where id=$2`,[target,I.gameA],/outside your access/i);
        }
        await denied(db,'insert into public.games(id,organization_id,league_id,location_id,home_team_id) values($1,$2,$3,$4,$5)',[id(952),I.org,I.a,I.locationA,I.teamB],/outside your access/i);
        await db.query('insert into public.games(id,organization_id,league_id,location_id,home_team_id,level_id) values($1,$2,$3,$4,$5,$6)',[id(953),I.org,I.a,I.locationA,I.teamA,I.levelA]);
        assert.deepEqual(await ids(db,'teams'),[I.teamA]);
        assert.deepEqual(await ids(db,'levels'),[I.levelA]);
        // All locations permits a genuinely TBD game; selected mode does not.
        await db.query('insert into public.games(id,organization_id,league_id) values($1,$2,$3)',[id(954),I.org,I.a]);
      },`insert into public.locations(id,name) values('${id(950)}','Foreign location');
        insert into public.organization_locations values('${I.otherOrg}','${id(950)}',true,null);`);
      await asUser(db,I.admin,async()=>{
        assert.equal(await value(db,'select private.can_read_organization_location($1,$2) value',[I.org,I.locationC]),true);
        assert.equal(await value(db,'select count(*)::integer value from public.games where location_id=$1',[I.locationC]),0);
        await db.query('insert into public.games(id,organization_id,league_id,location_id) values($1,$2,$3,$4)',[id(955),I.org,I.a,I.locationC]);
      },`update public.organization_member_league_access set all_locations=false,location_ids=array['${I.locationC}'::uuid] where user_id='${I.admin}'`);
      await asUser(db,I.admin,async()=>{
        assert.equal((await db.query('update public.games set notes=$1 where id=$2 returning id',['Historical links unchanged',I.gameA])).rows.length,1);
      },`insert into public.locations(id,name) values('${id(956)}','Historical inactive location');
        insert into public.organization_locations values('${I.org}','${id(956)}',false,null);
        insert into public.bill_to_accounts values('${id(957)}','${I.org}');
        update public.games set location_id='${id(956)}',bill_to_id='${id(957)}' where id='${I.gameA}'`);
      await asUser(db,I.owner,async()=>{
        assert.equal((await db.query('update public.games set home_team_id=$1,level_id=$2 where id=$3 returning id',[I.teamB,I.levelB,I.gameA])).rows.length,1);
      });
    });
    await t.test('legacy global ratings remain readable only in scope and mutable only by owners',async()=>{
      const setup=`insert into public.official_rankings values('${id(961)}','${I.officialA}',5),('${id(962)}','${I.officialB}',6)`;
      await asUser(db,I.admin,async()=>{
        assert.equal(await value(db,'select public.can_manage_rank() value'),false);
        assert.deepEqual(await ids(db,'official_rankings'),[id(961)]);
        assert.equal((await db.query('update public.official_rankings set rank=10 returning id')).rows.length,0);
      },setup);
      await asUser(db,I.owner,async()=>{
        assert.equal((await db.query('update public.official_rankings set rank=7 returning id')).rows.length,2);
      },setup);
    });
    await t.test('personal official assignment does not expose an excluded shared billing account',async()=>{
      await asUser(db,I.mixed,async()=>{
        assert.ok((await ids(db,'games')).includes(I.gameOwnB));
        assert.deepEqual(await ids(db,'bill_to_accounts'),[id(971)]);
      },`insert into public.bill_to_accounts values('${id(971)}','${I.org}'),('${id(972)}','${I.org}');
        update public.games set bill_to_id='${id(971)}' where id='${I.gameA}';
        update public.games set bill_to_id='${id(972)}' where id='${I.gameOwnB}';`);
    });
    await t.test('league configuration cannot grant access to a guessed hidden team or level',async()=>{
      const resources=[['team',I.teamA,I.teamB,'teams'],['level',I.levelA,I.levelB,'levels']];
      await asUser(db,I.admin,async()=>{
        for(const [kind,visible,hidden,plural] of resources) {
          const sql=`select private.save_organization_league_${plural}_impl($1,$2,$3) value`;
          assert.equal(await value(db,`select private.can_read_organization_${kind}($1,$2) value`,[I.org,hidden]),false);
          await denied(db,sql,[I.org,I.a,[visible,hidden]],/choose active/i);
          assert.equal(await value(db,`select private.can_read_organization_${kind}($1,$2) value`,[I.org,hidden]),false);
          assert.equal(await value(db,sql,[I.org,I.a,[visible]]),true);
          await denied(db,sql,[I.org,I.b,[visible]],/only leagues assigned/i);
        }
      });
      await asUser(db,I.admin,async()=>{
        for(const [,visible,,plural] of resources) await denied(db,`select private.save_organization_league_${plural}_impl($1,$2,$3)`,[I.org,I.a,[visible]],/only leagues assigned/i);
      },`update public.organization_member_league_access set all_locations=false,location_ids=array['${I.locationA}'::uuid] where user_id='${I.admin}'`);
      await asUser(db,I.owner,async()=>{
        for(const [,visible,hidden,plural] of resources) assert.equal(await value(db,`select private.save_organization_league_${plural}_impl($1,$2,$3) value`,[I.org,I.a,[visible,hidden]]),true);
      });
    });
    await t.test('assignment references cannot manufacture visibility of a hidden or unconfigured official',async()=>{
      await asUser(db,I.admin,async()=>{
        for(const hidden of [I.officialB,id(982)]) {
          assert.equal(await value(db,'select private.can_read_organization_official($1,$2) value',[I.org,hidden]),false);
          await denied(db,'insert into public.assignments(id,game_id,official_id) values($1,$2,$3)',[id(981),I.gameA,hidden],/official is outside your access/i);
          await denied(db,'update public.assignments set official_id=$1 where id=$2',[hidden,I.assignmentA],/official is outside your access/i);
          assert.equal(await value(db,'select private.can_read_organization_official($1,$2) value',[I.org,hidden]),false);
        }
        await db.query('insert into public.assignments(id,game_id,official_id) values($1,$2,$3)',[id(983),I.gameA,I.officialA]);
        assert.equal((await db.query('update public.assignments set official_id=official_id,status=$1 where id=$2 returning id',['accepted',I.assignmentA])).rows.length,1);
      },`insert into public.officials(id,active) values('${id(982)}',true);
        insert into public.organization_officials values('${I.org}','${id(982)}',true);`);
      await asUser(db,I.mixed,async()=>{
        await db.query('insert into public.assignments(id,game_id,official_id) values($1,$2,$3)',[id(984),I.gameA,I.ownOfficial]);
      });
      await asUser(db,I.owner,async()=>{
        await db.query('insert into public.assignments(id,game_id,official_id) values($1,$2,$3)',[id(985),I.gameA,I.officialB]);
      });
      // The trusted service may already have attached this official historically.
      await asUser(db,I.admin,async()=>{
        assert.equal((await db.query('update public.assignments set official_id=official_id,status=$1 where id=$2 returning id',['accepted',id(986)])).rows.length,1);
      },`insert into public.assignments(id,game_id,official_id) values('${id(986)}','${I.gameA}','${I.officialB}')`);
    });
  } finally { await db.close(); }
});

test('migration backfills All locations only inside existing league grants; new grants default deny',async()=>{
  const db=new PGlite();
  try {
    await db.exec(`
      create table public.organization_member_league_access(organization_id uuid,user_id uuid,league_id uuid);
      create table public.organization_invitations(id uuid,league_ids uuid[]);
      insert into public.organization_member_league_access values('${I.org}','${I.admin}','${I.a}');
      insert into public.organization_invitations values('${id(201)}',array['${I.a}'::uuid]),('${id(202)}','{}'::uuid[]);
    `);
    const prefix=migration.slice(0,migration.indexOf('-- League administrators'));
    assert.match(prefix,/add column all_locations/);
    await db.exec(prefix);
    assert.deepEqual((await db.query('select * from public.organization_member_league_access')).rows,[{organization_id:I.org,user_id:I.admin,league_id:I.a,all_locations:true,location_ids:[]}]);
    const invitations=(await db.query('select id,league_access from public.organization_invitations order by id')).rows;
    assert.deepEqual(invitations,[{id:id(201),league_access:[{league_id:I.a,all_locations:true,location_ids:[]}]},{id:id(202),league_access:[]}]);
    await db.query('insert into public.organization_member_league_access(organization_id,user_id,league_id) values($1,$2,$3)',[I.org,I.empty,I.b]);
    assert.deepEqual((await db.query('select all_locations,location_ids from public.organization_member_league_access where user_id=$1',[I.empty])).rows,[{all_locations:false,location_ids:[]}]);
  } finally {await db.close();}
});
