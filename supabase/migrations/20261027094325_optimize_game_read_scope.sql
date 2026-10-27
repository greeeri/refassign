-- Batch the existing canonical read predicate by distinct scope. This private
-- helper accepts no caller-supplied identity and returns only the current
-- user's game IDs. SECURITY DEFINER is needed for the same internal table
-- reads as can_read_organization_game, without recursively invoking game RLS.
begin;

create or replace function private.current_readable_game_ids()
returns setof uuid
language sql stable security definer set search_path = '' as $$
  with identity as materialized (
    select auth.uid() as user_id
  ), candidate_scopes as materialized (
    select distinct g.organization_id, g.league_id, g.location_id
    from public.games g
    where (select user_id from identity) is not null
  ), allowed_scopes as materialized (
    select s.* from candidate_scopes s
    where private.can_access_organization_league_location(
      s.organization_id, s.league_id, s.location_id,
      (select user_id from identity)
    )
  )
  select g.id from public.games g
  join allowed_scopes s on s.organization_id = g.organization_id
    and s.league_id = g.league_id
    and s.location_id is not distinct from g.location_id
  union
  -- Keep personal reads independent of management scope/subscription/coverage.
  select g.id from public.games g
  join public.assignments a on a.game_id = g.id
  join public.officials o on o.id = a.official_id
  where o.auth_user_id = (select user_id from identity);
$$;

revoke all on function private.current_readable_game_ids() from public, anon;
grant execute on function private.current_readable_game_ids() to authenticated, service_role;

-- Uncorrelated subqueries build a hashed ID set once per statement, rather
-- than invoking the canonical permission function twice for every game.
-- Retain the restrictive fence and all write policies unchanged.
alter policy "Location scope read fence" on public.games
  using (id in (select private.current_readable_game_ids()));
alter policy "Organization league users read games" on public.games
  using (id in (select private.current_readable_game_ids()));

create or replace function public.get_assignment_venue_directory_v2(
  p_organization_id uuid, p_league_id uuid default null
)
returns table(location_id uuid, name text, field_complex text, venue_id uuid, venue_name text)
language plpgsql stable security invoker set search_path = '' as $$
declare
  is_owner boolean := private.can_manage_organization(p_organization_id);
begin
  return query
  with used_scopes as materialized (
    select distinct g.organization_id, g.league_id, g.location_id
    from public.games g
    where (select auth.uid()) is not null
      and p_organization_id is not null
      and g.organization_id = p_organization_id
      and (p_league_id is null or g.league_id = p_league_id)
      and g.archived_at is null and g.location_id is not null
  ), used_locations as materialized (
    select distinct s.location_id from used_scopes s
    -- Personal-assignment visibility never grants management venue access.
    where is_owner or private.can_access_organization_league_location(
      s.organization_id, s.league_id, s.location_id, (select auth.uid())
    )
  )
  select used.location_id, l.name, nullif(btrim(ol.field_complex), ''), l.venue_id, v.name
  from used_locations used
  join public.locations l on l.id = used.location_id
  left join public.organization_locations ol
    on ol.organization_id = p_organization_id
    and ol.location_id = used.location_id and ol.active
  left join public.venues v on v.id = l.venue_id
  order by used.location_id;
end;
$$;

commit;
