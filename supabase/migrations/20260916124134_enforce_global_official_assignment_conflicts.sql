-- Make one database-level conflict check authoritative for every assignment
-- entry path (manual, bulk, linked games, saved crews, Self Assign, and
-- AutoAssign). The official record is shared by organizations, so deliberately
-- do not scope this lookup by organization_id or league_id.

create or replace function private.enforce_global_official_assignment_conflict()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_game public.games%rowtype;
  v_conflict record;
begin
  -- Declined/cancelled offers do not reserve an official's time.
  if new.official_id is null
     or lower(coalesce(new.status, '')) in ('declined', 'cancelled', 'canceled') then
    return new;
  end if;

  select game.*
  into v_game
  from public.games game
  where game.id = new.game_id;

  -- TBD games cannot overlap a known time. Cancelled and rained-out games no
  -- longer reserve the official, while On Hold/Suspended games still do.
  if v_game.id is null or v_game.starts_at is null
     or lower(coalesce(v_game.status, 'active')) in
       ('cancelled', 'canceled', 'rained_out', 'rain_out') then
    return new;
  end if;

  -- Serialize all assignment attempts for this official. This closes the race
  -- where two organizations assign the same official at the same instant and
  -- both transactions pass an ordinary EXISTS check.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(new.official_id::text, 0)
  );

  select
    assignment.id as assignment_id,
    game.id as game_id,
    game.starts_at,
    game.starts_at
      + pg_catalog.make_interval(mins => coalesce(game.duration_minutes, 110)) as ends_at
  into v_conflict
  from public.assignments assignment
  join public.games game on game.id = assignment.game_id
  where assignment.official_id = new.official_id
    and assignment.id is distinct from new.id
    and lower(coalesce(assignment.status, '')) not in
      ('declined', 'cancelled', 'canceled')
    and lower(coalesce(game.status, 'active')) not in
      ('cancelled', 'canceled', 'rained_out', 'rain_out')
    and game.starts_at is not null
    and game.starts_at
          < v_game.starts_at
            + pg_catalog.make_interval(mins => coalesce(v_game.duration_minutes, 110))
    and game.starts_at
          + pg_catalog.make_interval(mins => coalesce(game.duration_minutes, 110))
          > v_game.starts_at
  order by game.starts_at, assignment.id
  limit 1;

  if found then
    raise exception
      'Official is unavailable because of another assignment from % to %.',
      to_char(v_conflict.starts_at at time zone 'America/Chicago', 'MM/DD/YYYY FMHH12:MI AM'),
      to_char(v_conflict.ends_at at time zone 'America/Chicago', 'FMHH12:MI AM')
      using errcode = '23P01',
            detail = format(
              'Conflicting assignment %s on game %s.',
              v_conflict.assignment_id,
              v_conflict.game_id
            ),
            hint = 'Unassign the official from the other game or choose a different official.';
  end if;

  return new;
end;
$$;

revoke all on function private.enforce_global_official_assignment_conflict()
from public, anon, authenticated;

-- Replace the older trigger, which did not run for status-only reactivation
-- and explicitly skipped Self Assign records.
drop trigger if exists trg_prevent_overlapping_official_assignments
on public.assignments;
drop trigger if exists enforce_global_official_assignment_conflicts
on public.assignments;

create trigger enforce_global_official_assignment_conflicts
before insert or update of game_id, official_id, status
on public.assignments
for each row
execute function private.enforce_global_official_assignment_conflict();

comment on function private.enforce_global_official_assignment_conflict() is
  'Prevents an official from holding overlapping active assignments across every league and organization, with per-official transaction serialization.';
