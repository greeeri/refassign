-- Return the assignment first; the client can load permitted venue details later.
-- Keep the same caller privileges and predicates as my_official_assignments.
create function public.my_official_assignments_brief(p_organization_id uuid)
returns table(
  assignment_id uuid, game_id uuid, game_number text, game_status text,
  position_name text, starts_at timestamptz, home_team text, away_team text,
  location_name text, location_address text, location_city text,
  location_state text, league_name text, level_name text, notes text,
  status text, published_at timestamptz, accept_by timestamptz,
  responded_at timestamptz, decline_reason text, response_token uuid,
  location_id uuid
)
language sql stable security invoker set search_path = '' as $$
  select a.id, g.id, g.game_number, g.status, position.name, g.starts_at,
         home.name, away.name, null::text, null::text, null::text,
         null::text, league.name, level.name, g.notes, a.status,
         a.published_at, a.accept_by, a.responded_at, a.decline_reason,
         a.response_token, g.location_id
  from public.assignments a
  join public.officials official on official.id = a.official_id
  join public.games g on g.id = a.game_id
  left join public.teams home on home.id = g.home_team_id
  left join public.teams away on away.id = g.away_team_id
  left join public.leagues league on league.id = g.league_id
  left join public.levels level on level.id = g.level_id
  left join public.sport_positions position on position.id = a.position_id
  where official.auth_user_id = (select auth.uid())
    and a.published_at is not null
    and g.organization_id = p_organization_id
    and exists (
      select 1 from public.organization_officials organization_official
      where organization_official.organization_id = p_organization_id
        and organization_official.official_id = official.id
        and organization_official.active
    )
  order by g.starts_at;
$$;

revoke all on function public.my_official_assignments_brief(uuid) from public, anon;
grant execute on function public.my_official_assignments_brief(uuid) to authenticated;
notify pgrst, 'reload schema';
