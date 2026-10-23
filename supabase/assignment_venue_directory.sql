-- Assignment filter options are schedule resources, not the organization's
-- full setup directory. Keep the selected league and current management scope
-- inside the query, before returning field names or complex metadata.
begin;

create or replace function public.get_assignment_venue_directory(
  p_organization_id uuid,
  p_league_id uuid default null
)
returns table(location_id uuid, name text, field_complex text)
language plpgsql stable security invoker set search_path = '' as $$
declare
  is_owner boolean := private.can_manage_organization(p_organization_id);
begin
  return query
  with used_locations as materialized (
    select distinct g.location_id
    from public.games g
    where (select auth.uid()) is not null
      and p_organization_id is not null
      and g.organization_id = p_organization_id
      and (p_league_id is null or g.league_id = p_league_id)
      and g.archived_at is null
      and g.location_id is not null
      -- Personal official reads outside the management grants must not enter
      -- this directory, even when the underlying game RLS permits that read.
      and (is_owner or private.can_access_organization_league_location(
        g.organization_id, g.league_id, g.location_id, (select auth.uid())
      ))
  )
  select used.location_id, l.name, nullif(btrim(ol.field_complex), '')
  from used_locations used
  join public.locations l on l.id = used.location_id
  left join public.organization_locations ol
    on ol.organization_id = p_organization_id
    and ol.location_id = used.location_id
    and ol.active
  -- Include authorized historical/inactive fields still used by non-archived
  -- games, but only current organization links supply complex membership.
  -- Never expand a complex to siblings unused by this league's schedule.
  order by used.location_id;
end;
$$;

revoke all on function public.get_assignment_venue_directory(uuid, uuid) from public, anon;
grant execute on function public.get_assignment_venue_directory(uuid, uuid) to authenticated, service_role;

commit;
