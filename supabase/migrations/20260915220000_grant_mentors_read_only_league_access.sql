drop policy if exists "Mentors read associated league games" on public.games;
create policy "Mentors read associated league games"
on public.games for select to authenticated
using (
  exists (
    select 1
    from public.organization_memberships membership
    join public.organization_member_league_access access
      on access.organization_id=membership.organization_id
     and access.user_id=membership.user_id
     and access.league_id=games.league_id
    join public.organization_league_coverage coverage
      on coverage.organization_id=membership.organization_id
     and coverage.league_id=access.league_id
     and coverage.active
    where membership.organization_id=games.organization_id
      and membership.user_id=(select auth.uid())
      and membership.role='mentor'
  )
);

drop policy if exists "Mentors read associated league assignments" on public.assignments;
create policy "Mentors read associated league assignments"
on public.assignments for select to authenticated
using (
  exists (
    select 1
    from public.games game
    join public.organization_memberships membership
      on membership.organization_id=game.organization_id
     and membership.user_id=(select auth.uid())
     and membership.role='mentor'
    join public.organization_member_league_access access
      on access.organization_id=membership.organization_id
     and access.user_id=membership.user_id
     and access.league_id=game.league_id
    join public.organization_league_coverage coverage
      on coverage.organization_id=membership.organization_id
     and coverage.league_id=access.league_id
     and coverage.active
    where game.id=assignments.game_id
  )
);
