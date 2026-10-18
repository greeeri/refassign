const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');

// Execute the deployed RPC, not a copy of its authorization logic. The fixture
// supplies only its schema dependencies; calls run with the actual client roles.
test('mentor self-assignment permissions and behavior', async (t) => {
  const db = new PGlite();
  let nextId = 0;
  const id = () => `00000000-0000-4000-8000-${String(++nextId).padStart(12, '0')}`;
  const org = id();
  const otherOrg = id();
  const league = id();
  const otherLeague = id();
  const sport = id();
  const otherSport = id();
  const refereePosition = id();
  const mentorPosition = id();

  async function user({ active = true, certified = true, official = true } = {}) {
    const userId = id();
    await db.query('insert into auth.users(id) values ($1)', [userId]);
    if (!official) return { userId, officialId: null };
    const officialId = id();
    await db.query('insert into public.officials values ($1,$2,$3)', [officialId, userId, active]);
    if (certified !== null) {
      await db.query('insert into public.official_mentor_certifications values ($1,$2)', [officialId, certified]);
    }
    return { userId, officialId };
  }

  async function profile(actor, { organizationId = org, roles = ['mentor'], leagues = [league] } = {}) {
    await db.query('insert into public.organization_user_access_profiles values ($1,$2,$3::text[],$4::uuid[])',
      [organizationId, actor.userId, roles, leagues]);
  }

  async function game({ organizationId = org, leagueId = league, sportId = sport, status = 'open', past = false } = {}) {
    const gameId = id();
    await db.query(`insert into public.games values ($1,$2,$3,$4,now() + $5::interval,$6)`,
      [gameId, organizationId, leagueId, sportId, past ? '-1 day' : '1 day', status]);
    return gameId;
  }

  async function selfAssign(actor, gameId, role = 'authenticated') {
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [actor?.userId ?? '']);
    await db.exec(role === 'anon' ? 'set role anon' : 'set role authenticated');
    try {
      const result = await db.query('select public.self_assign_game_mentor($1) as id', [gameId]);
      return result.rows[0].id;
    } finally {
      await db.exec('reset role');
    }
  }

  async function state(gameId) {
    return {
      slots: (await db.query('select * from public.game_mentor_slots where game_id=$1', [gameId])).rows,
      assignments: (await db.query('select * from public.assignments where game_id=$1 order by id', [gameId])).rows,
    };
  }

  async function rejectsWithoutChanges(actor, gameId, message, code = 'P0001', role = 'authenticated') {
    const before = await state(gameId);
    await assert.rejects(selfAssign(actor, gameId, role), (error) => {
      assert.equal(error.code, code);
      assert.match(error.message, message);
      return true;
    });
    assert.deepEqual(await state(gameId), before, 'a rejected call must not change slots or assignments');
  }

  async function assertAccepted(actor, gameId) {
    const assignmentId = await selfAssign(actor, gameId);
    const { slots, assignments } = await state(gameId);
    assert.equal(slots.length, 1);
    assert.equal(slots[0].position_id, mentorPosition);
    const assignment = assignments.find((row) => row.id === assignmentId);
    assert.ok(assignment, 'RPC must return its inserted assignment');
    assert.equal(assignment.game_id, gameId);
    assert.equal(assignment.official_id, actor.officialId);
    assert.equal(assignment.position_id, mentorPosition);
    assert.equal(assignment.status, 'accepted');
    assert.equal(assignment.assignment_source, 'self_assign');
    assert.ok(assignment.published_at);
    assert.ok(assignment.responded_at);
    assert.deepEqual(assignment.published_at, assignment.responded_at);
    assert.equal(assignments.filter((row) => row.position_id === mentorPosition && row.status !== 'declined').length, 1);
    return { assignmentId, slot: slots[0] };
  }

  try {
    await db.exec(`
      create role anon;
      create role authenticated;
      create schema auth;
      create schema private;
      create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql as $$
        select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
      $$;
      -- Management helpers are dependencies of other RPCs in this migration.
      -- They intentionally grant no management authority to these mentors.
      create function private.can_manage_game(uuid) returns boolean language sql as $$ select false $$;
      create function private.can_access_organization(uuid) returns boolean language sql as $$ select false $$;
      create table public.games(
        id uuid primary key, organization_id uuid, league_id uuid,
        sport_id uuid, starts_at timestamptz, status text
      );
      create table public.sport_positions(id uuid primary key, sport_id uuid, name text, sort_order integer);
      create table public.organization_user_access_profiles(
        organization_id uuid, user_id uuid, roles text[], league_ids uuid[]
      );
      create table public.organization_memberships(organization_id uuid, user_id uuid, role text);
      create table public.organization_member_league_access(organization_id uuid, user_id uuid, league_id uuid);
      create table public.officials(id uuid primary key, auth_user_id uuid, active boolean);
      create table public.official_mentor_certifications(official_id uuid primary key, certified boolean);
      create table public.assignments(
        id uuid primary key default gen_random_uuid(), game_id uuid, official_id uuid,
        position_id uuid, status text, assignment_source text,
        assigned_at timestamptz default now(), published_at timestamptz,
        responded_at timestamptz, accept_by timestamptz, published_by uuid,
        email_sent_at timestamptz, resend_email_id text, email_error text,
        response_token uuid, decline_reason text
      );
    `);
    await db.query('insert into public.sport_positions values ($1,$2,$3,$4),($5,$2,$6,$7),($8,$2,$9,$10),($11,$12,$13,$14)',
      [refereePosition, sport, 'Referee', 0, mentorPosition, 'MeNtOr', 1,
        id(), 'Assistant Mentor', 2, id(), otherSport, 'Mentor', -1]);
    await db.exec(fs.readFileSync(path.join(__dirname, '../supabase/migrations/20260919190000_game_mentor_slots.sql'), 'utf8'));

    await t.test('denies missing identity, unrelated users, and viewers even with a certified official', async () => {
      const gameId = await game();
      await rejectsWithoutChanges(null, gameId, /Mentor access is required/, '42501');
      const unrelated = await user();
      await rejectsWithoutChanges(unrelated, gameId, /Mentor access is required/, '42501');
      const viewer = await user();
      await profile(viewer, { roles: ['official', 'viewer'] });
      await db.query('insert into public.organization_memberships values ($1,$2,$3)', [org, viewer.userId, 'viewer']);
      await db.query('insert into public.organization_member_league_access values ($1,$2,$3)', [org, viewer.userId, league]);
      await rejectsWithoutChanges(viewer, gameId, /Mentor access is required/, '42501');
    });

    await t.test('multi-role profiles grant mentor access only in their organization and leagues', async () => {
      const mentor = await user();
      await profile(mentor, { roles: ['official', 'mentor', 'viewer'] });
      await rejectsWithoutChanges(mentor, await game({ leagueId: otherLeague }), /Mentor access is required/, '42501');
      await rejectsWithoutChanges(mentor, await game({ organizationId: otherOrg }), /Mentor access is required/, '42501');
      const gameId = await game();
      const { slot } = await assertAccepted(mentor, gameId);
      assert.equal(slot.created_by, mentor.userId);
      await rejectsWithoutChanges(mentor, gameId, /already has a mentor assigned/);
    });

    await t.test('an unrestricted mentor profile allows all leagues but never another organization', async () => {
      const mentor = await user();
      await profile(mentor, { leagues: [] });
      await assertAccepted(mentor, await game({ leagueId: otherLeague, status: 'active' }));
      await rejectsWithoutChanges(mentor, await game({ organizationId: otherOrg, leagueId: otherLeague }), /Mentor access is required/, '42501');
    });

    await t.test('legacy mentor membership requires a league grant for the same organization and user', async () => {
      const mentor = await user();
      const otherUser = await user();
      const gameId = await game();
      await db.query('insert into public.organization_memberships values ($1,$2,$3)', [org, mentor.userId, 'mentor']);
      await rejectsWithoutChanges(mentor, gameId, /Mentor access is required/, '42501');
      await db.query('insert into public.organization_member_league_access values ($1,$2,$3)', [otherOrg, mentor.userId, league]);
      await rejectsWithoutChanges(mentor, gameId, /Mentor access is required/, '42501');
      await db.query('insert into public.organization_member_league_access values ($1,$2,$3)', [org, otherUser.userId, league]);
      await rejectsWithoutChanges(mentor, gameId, /Mentor access is required/, '42501');
      await db.query('insert into public.organization_member_league_access values ($1,$2,$3)', [org, mentor.userId, league]);
      await rejectsWithoutChanges(mentor, await game({ leagueId: otherLeague }), /Mentor access is required/, '42501');
      await rejectsWithoutChanges(mentor, await game({ organizationId: otherOrg }), /Mentor access is required/, '42501');
      await assertAccepted(mentor, gameId);
    });

    await t.test('requires the caller to have an active official with an explicit mentor certification', async () => {
      for (const options of [{ official: false }, { active: false }, { certified: null }, { certified: false }]) {
        const mentor = await user(options);
        await profile(mentor);
        await rejectsWithoutChanges(mentor, await game(), /An active mentor-certified official profile is required/);
      }
    });

    await t.test('rejects every non-declined occupied mentor slot without replacing its assignment', async () => {
      const mentor = await user();
      const assigned = await user();
      await profile(mentor);
      for (const status of ['proposed', 'published', 'accepted']) {
        const gameId = await game();
        await db.query(`insert into public.assignments(game_id,official_id,position_id,status,assignment_source)
          values ($1,$2,$3,$4,'manager')`, [gameId, assigned.officialId, mentorPosition, status]);
        if (status === 'accepted') {
          await db.query('insert into public.game_mentor_slots(game_id,position_id,created_by) values ($1,$2,$3)',
            [gameId, mentorPosition, assigned.userId]);
        }
        await rejectsWithoutChanges(mentor, gameId, /already has a mentor assigned/);
      }
    });

    await t.test('reuses an empty mentor slot and ignores declined mentors and occupied other positions', async () => {
      const mentor = await user();
      const previous = await user();
      await profile(mentor);
      const gameId = await game();
      await db.query('insert into public.game_mentor_slots(game_id,position_id,created_by) values ($1,$2,$3)',
        [gameId, mentorPosition, previous.userId]);
      await db.query(`insert into public.assignments(game_id,official_id,position_id,status,assignment_source)
        values ($1,$2,$3,'declined','manager'),($1,$2,$4,'accepted','manager')`,
        [gameId, previous.officialId, mentorPosition, refereePosition]);
      const before = await state(gameId);
      const { slot } = await assertAccepted(mentor, gameId);
      const after = await state(gameId);
      assert.deepEqual(slot, before.slots[0], 'the existing slot and its original creator are preserved');
      assert.equal(after.assignments.length, 3);
      for (const assignment of before.assignments) {
        assert.deepEqual(after.assignments.find((row) => row.id === assignment.id), assignment);
      }
    });

    await t.test('rejects nonexistent, past, and inactive games before making changes', async () => {
      const mentor = await user();
      await profile(mentor);
      await rejectsWithoutChanges(mentor, id(), /no longer available for mentor self-assignment/);
      await rejectsWithoutChanges(mentor, await game({ past: true }), /no longer available for mentor self-assignment/);
      for (const status of ['inactive', 'cancelled', 'completed']) {
        await rejectsWithoutChanges(mentor, await game({ status }), /no longer available for mentor self-assignment/);
      }
    });

    await t.test('requires a configured mentor position for this game sport', async () => {
      const mentor = await user();
      await profile(mentor);
      await rejectsWithoutChanges(mentor, await game({ sportId: id() }), /A Mentor position is not configured for this sport/);
    });

    await t.test('anonymous callers cannot execute the RPC even with a mentor identity claim', async () => {
      const mentor = await user();
      await profile(mentor);
      const privileges = (await db.query(`select
        has_function_privilege('anon','public.self_assign_game_mentor(uuid)','EXECUTE') as anonymous,
        has_function_privilege('authenticated','public.self_assign_game_mentor(uuid)','EXECUTE') as authenticated`)).rows[0];
      assert.deepEqual(privileges, { anonymous: false, authenticated: true });
      await rejectsWithoutChanges(mentor, await game(), /permission denied for function self_assign_game_mentor/, '42501', 'anon');
    });
  } finally {
    await db.close();
  }
});
