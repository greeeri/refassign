-- Candidate eligibility must use the same global schedule boundary as the
-- database assignment trigger. Return only the target game and busy official;
-- details from an unrelated organization are intentionally not exposed.

create or replace function public.get_assignment_candidate_conflicts(
  p_target_game_ids uuid[]
)
returns table(target_game_id uuid, official_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select distinct
    target.id as target_game_id,
    assignment.official_id
  from public.games target
  join public.organization_officials candidate
    on candidate.organization_id = target.organization_id
   and candidate.active
  join public.assignments assignment
    on assignment.official_id = candidate.official_id
   and lower(coalesce(assignment.status, '')) not in
       ('declined', 'cancelled', 'canceled')
  join public.games occupied
    on occupied.id = assignment.game_id
   and occupied.id <> target.id
   and occupied.starts_at is not null
   and lower(coalesce(occupied.status, 'active')) not in
       ('cancelled', 'canceled', 'rained_out', 'rain_out')
  where target.id = any(coalesce(p_target_game_ids, '{}'::uuid[]))
    and target.starts_at is not null
    and lower(coalesce(target.status, 'active')) not in
        ('cancelled', 'canceled', 'rained_out', 'rain_out')
    and private.can_manage_organization_league(
      target.organization_id,
      target.league_id,
      (select auth.uid())
    )
    and occupied.starts_at
          < target.starts_at
            + pg_catalog.make_interval(
                mins => coalesce(target.duration_minutes, 110)
              )
    and occupied.starts_at
          + pg_catalog.make_interval(
              mins => coalesce(occupied.duration_minutes, 110)
            )
          > target.starts_at;
$$;

revoke all on function public.get_assignment_candidate_conflicts(uuid[])
from public, anon;
grant execute on function public.get_assignment_candidate_conflicts(uuid[])
to authenticated;

comment on function public.get_assignment_candidate_conflicts(uuid[]) is
  'Returns globally busy official IDs for assignment candidates without exposing cross-organization game details.';
