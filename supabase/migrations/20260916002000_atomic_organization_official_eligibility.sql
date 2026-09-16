create or replace function private.set_organization_official_eligibility(
  p_organization_id uuid,
  p_official_id uuid,
  p_league_ids uuid[],
  p_level_ids uuid[]
) returns void
language plpgsql security definer set search_path='' as $$
begin
  if (select auth.uid()) is null
     or not private.can_manage_organization(p_organization_id) then
    raise exception 'Only an organization owner, administrator, or assignor can update official eligibility.';
  end if;

  if not exists (
    select 1 from public.organization_officials link
    where link.organization_id=p_organization_id
      and link.official_id=p_official_id
      and link.active
  ) then
    raise exception 'Connect this official to the organization before updating eligibility.';
  end if;

  if exists (
    select 1 from unnest(coalesce(p_league_ids,'{}'::uuid[])) selected(id)
    where not exists (
      select 1 from public.organization_league_coverage coverage
      where coverage.organization_id=p_organization_id
        and coverage.league_id=selected.id
        and coverage.active
    )
  ) then
    raise exception 'A selected league is not connected to this organization.';
  end if;

  if exists (
    select 1 from unnest(coalesce(p_level_ids,'{}'::uuid[])) selected(id)
    where not exists (
      select 1 from public.organization_levels level_access
      where level_access.organization_id=p_organization_id
        and level_access.level_id=selected.id
        and level_access.active
    )
  ) then
    raise exception 'A selected level is not connected to this organization.';
  end if;

  delete from public.official_league_eligibility eligibility
  where eligibility.official_id=p_official_id
    and exists (
      select 1 from public.organization_league_coverage coverage
      where coverage.organization_id=p_organization_id
        and coverage.league_id=eligibility.league_id
    );
  insert into public.official_league_eligibility(official_id,league_id)
  select p_official_id,selected.id
  from (select distinct id from unnest(coalesce(p_league_ids,'{}'::uuid[])) selected(id)) selected
  on conflict do nothing;

  delete from public.official_level_eligibility eligibility
  where eligibility.official_id=p_official_id
    and exists (
      select 1 from public.organization_levels level_access
      where level_access.organization_id=p_organization_id
        and level_access.level_id=eligibility.level_id
    );
  insert into public.official_level_eligibility(official_id,level_id)
  select p_official_id,selected.id
  from (select distinct id from unnest(coalesce(p_level_ids,'{}'::uuid[])) selected(id)) selected
  on conflict do nothing;
end $$;

revoke all on function private.set_organization_official_eligibility(uuid,uuid,uuid[],uuid[]) from public,anon,authenticated;

create or replace function public.set_organization_official_eligibility(
  p_organization_id uuid,
  p_official_id uuid,
  p_league_ids uuid[] default '{}'::uuid[],
  p_level_ids uuid[] default '{}'::uuid[]
) returns void
language sql security definer set search_path='' as $$
  select private.set_organization_official_eligibility(
    p_organization_id,p_official_id,p_league_ids,p_level_ids
  )
$$;

revoke all on function public.set_organization_official_eligibility(uuid,uuid,uuid[],uuid[]) from public,anon;
grant execute on function public.set_organization_official_eligibility(uuid,uuid,uuid[],uuid[]) to authenticated;
