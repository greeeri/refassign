create or replace function private.prepare_game_import_locations_impl(
  p_organization_id uuid,
  p_location_names text[]
)
returns table(id uuid, name text, city text, state text)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not private.can_manage_organization(p_organization_id) then
    raise exception 'Not authorized.';
  end if;

  insert into public.organization_locations (
    organization_id,
    location_id,
    active,
    added_by
  )
  select
    p_organization_id,
    matched.id,
    true,
    auth.uid()
  from unnest(coalesce(p_location_names, array[]::text[])) requested(name)
  cross join lateral (
    select location.id
    from public.locations location
    where location.active
      and regexp_replace(lower(location.name), '[^a-z0-9]+', '', 'g') =
          regexp_replace(lower(trim(requested.name)), '[^a-z0-9]+', '', 'g')
    order by
      exists (
        select 1
        from public.organization_locations existing
        where existing.organization_id = p_organization_id
          and existing.location_id = location.id
      ) desc,
      location.id
    limit 1
  ) matched
  on conflict (organization_id, location_id)
  do update set active = true;

  return query
  select
    location.id,
    coalesce(nullif(link.display_name, ''), location.name),
    location.city,
    location.state
  from public.organization_locations link
  join public.locations location on location.id = link.location_id
  where link.organization_id = p_organization_id
    and link.active
    and location.active
  order by coalesce(nullif(link.display_name, ''), location.name);
end;
$$;

create or replace function public.prepare_game_import_locations(
  p_organization_id uuid,
  p_location_names text[]
)
returns table(id uuid, name text, city text, state text)
language sql
security invoker
set search_path = ''
as $$
  select *
  from private.prepare_game_import_locations_impl(
    p_organization_id,
    p_location_names
  );
$$;

revoke all on function private.prepare_game_import_locations_impl(uuid, text[])
  from public, anon;
revoke all on function public.prepare_game_import_locations(uuid, text[])
  from public, anon;
grant execute on function private.prepare_game_import_locations_impl(uuid, text[])
  to authenticated;
grant execute on function public.prepare_game_import_locations(uuid, text[])
  to authenticated;
