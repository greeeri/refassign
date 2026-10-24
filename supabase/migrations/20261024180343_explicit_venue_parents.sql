-- Additive explicit venue-parent APIs. No identity remapping, guessed backfill,
-- table grants, RLS changes, or legacy field_complex semantics are changed.
begin;

create index if not exists locations_venue_id_id_idx
  on public.locations (venue_id, id) where venue_id is not null;
create index if not exists games_assignment_venue_directory_idx
  on public.games (organization_id, league_id, location_id)
  where archived_at is null and location_id is not null;

-- Available parents are exactly the venues already readable by the caller.
-- In particular, an organization owner cannot discover an unrelated venue by
-- searching this RPC. Creating a new venue remains a super-admin operation.
create or replace function public.get_location_venue_options()
returns table(id uuid, name text, address text, city text, state text)
language sql stable security invoker set search_path = '' as $$
  select v.id, v.name, v.address, v.city, v.state
  from public.venues v
  where (select auth.uid()) is not null
  order by v.name, v.id;
$$;

-- The caller must send the parent they actually reviewed (including NULL).
-- Row locking plus expected-value checking prevents a stale screen/import from
-- silently overwriting somebody else's mapping. NULL deliberately unassigns.
create or replace function public.set_location_venue(
  p_location_id uuid,
  p_venue_id uuid,
  p_expected_venue_id uuid
)
returns uuid
language plpgsql security invoker set search_path = '' as $$
declare
  current_parent uuid;
  changed_rows integer;
begin
  if (select auth.uid()) is null
    or not private.can_manage_shared_resource('location', p_location_id) then
    raise exception 'You cannot change this field''s venue.' using errcode = '42501';
  end if;

  select l.venue_id into current_parent
  from public.locations l where l.id = p_location_id for update;
  if not found then
    raise exception 'This field is unavailable or outside your access.' using errcode = '42501';
  end if;
  if current_parent is distinct from p_expected_venue_id then
    raise exception 'The venue changed since you loaded this field. Refresh and review it before saving.' using errcode = '40001';
  end if;
  if p_venue_id is not null and not exists (
    select 1 from public.venues v where v.id = p_venue_id
  ) then
    raise exception 'The selected venue is unavailable or outside your access.' using errcode = '42501';
  end if;

  update public.locations l set venue_id = p_venue_id
  where l.id = p_location_id and l.venue_id is not distinct from p_expected_venue_id;
  get diagnostics changed_rows = row_count;
  if changed_rows <> 1 then
    raise exception 'The field could not be updated. Refresh and check your access.' using errcode = '42501';
  end if;
  return p_venue_id;
end;
$$;

-- Retain the old RPC unchanged for already deployed clients. Mirror its scope
-- here so fresh migration installs do not depend on the standalone v1 SQL.
-- Authorized field IDs are the entire universe: never add sibling fields.
create or replace function public.get_assignment_venue_directory_v2(
  p_organization_id uuid,
  p_league_id uuid default null
)
returns table(location_id uuid, name text, field_complex text, venue_id uuid, venue_name text)
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
      and (is_owner or private.can_access_organization_league_location(
        g.organization_id, g.league_id, g.location_id, (select auth.uid())
      ))
  )
  select used.location_id, l.name, nullif(btrim(ol.field_complex), ''), l.venue_id, v.name
  from used_locations used
  join public.locations l on l.id = used.location_id
  left join public.organization_locations ol
    on ol.organization_id = p_organization_id
    and ol.location_id = used.location_id
    and ol.active
  left join public.venues v on v.id = l.venue_id
  order by used.location_id;
end;
$$;

revoke all on function public.get_location_venue_options() from public, anon;
revoke all on function public.set_location_venue(uuid, uuid, uuid) from public, anon;
revoke all on function public.get_assignment_venue_directory_v2(uuid, uuid) from public, anon;
grant execute on function public.get_location_venue_options() to authenticated, service_role;
grant execute on function public.set_location_venue(uuid, uuid, uuid) to authenticated;
grant execute on function public.get_assignment_venue_directory_v2(uuid, uuid) to authenticated, service_role;

commit;
