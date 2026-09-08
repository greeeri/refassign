drop policy if exists "Organization users read connected leagues" on public.leagues;

create policy "Organization users read connected leagues"
on public.leagues for select to authenticated
using (
  exists (
    select 1
    from public.organization_league_coverage coverage
    join public.organization_memberships membership
      on membership.organization_id=coverage.organization_id
    where coverage.league_id=leagues.id
      and coverage.active
      and membership.user_id=(select auth.uid())
  )
  or exists (
    select 1
    from public.organization_league_coverage coverage
    join public.organization_officials organization_official
      on organization_official.organization_id=coverage.organization_id
    join public.officials official on official.id=organization_official.official_id
    where coverage.league_id=leagues.id
      and coverage.active
      and organization_official.active
      and official.auth_user_id=(select auth.uid())
  )
);

create or replace function private.create_organization_league_impl(
  p_organization_id uuid,
  p_name text,
  p_mileage_plan text
) returns uuid language plpgsql security definer set search_path='' as $$
declare v_league_id uuid;
begin
  if (select auth.uid()) is null or not private.can_manage_organization(p_organization_id) then
    raise exception 'Only organization owners, administrators, and assignors can add leagues.';
  end if;
  if length(trim(coalesce(p_name,'')))<1 then raise exception 'League name is required.'; end if;
  if p_mileage_plan not in ('one_way','round_trip','actual','none') then raise exception 'Invalid mileage plan.'; end if;

  select id into v_league_id from public.leagues where lower(name)=lower(trim(p_name)) limit 1;
  if v_league_id is null then
    insert into public.leagues(name,mileage_plan) values(trim(p_name),p_mileage_plan) returning id into v_league_id;
  end if;

  insert into public.organization_league_coverage(organization_id,league_id,coverage_type)
  values(p_organization_id,v_league_id,'All locations')
  on conflict do nothing;
  return v_league_id;
end $$;

create or replace function public.create_organization_league(
  p_organization_id uuid,p_name text,p_mileage_plan text
) returns uuid language sql security invoker set search_path='' as $$
  select private.create_organization_league_impl(p_organization_id,p_name,p_mileage_plan)
$$;

create or replace function private.update_organization_league_mileage_plan_impl(
  p_organization_id uuid,p_league_id uuid,p_mileage_plan text
) returns boolean language plpgsql security definer set search_path='' as $$
begin
  if (select auth.uid()) is null or not private.can_manage_organization(p_organization_id) then
    raise exception 'Only organization owners, administrators, and assignors can update leagues.';
  end if;
  if p_mileage_plan not in ('one_way','round_trip','actual','none') then raise exception 'Invalid mileage plan.'; end if;
  if not exists (
    select 1 from public.organization_league_coverage
    where organization_id=p_organization_id and league_id=p_league_id and active
  ) then raise exception 'This league is not connected to the organization.'; end if;
  update public.leagues set mileage_plan=p_mileage_plan where id=p_league_id;
  return found;
end $$;

create or replace function public.update_organization_league_mileage_plan(
  p_organization_id uuid,p_league_id uuid,p_mileage_plan text
) returns boolean language sql security invoker set search_path='' as $$
  select private.update_organization_league_mileage_plan_impl(p_organization_id,p_league_id,p_mileage_plan)
$$;

revoke all on function private.create_organization_league_impl(uuid,text,text) from public,anon;
revoke all on function private.update_organization_league_mileage_plan_impl(uuid,uuid,text) from public,anon;
revoke all on function public.create_organization_league(uuid,text,text) from public,anon;
revoke all on function public.update_organization_league_mileage_plan(uuid,uuid,text) from public,anon;
grant execute on function private.create_organization_league_impl(uuid,text,text) to authenticated;
grant execute on function private.update_organization_league_mileage_plan_impl(uuid,uuid,text) to authenticated;
grant execute on function public.create_organization_league(uuid,text,text) to authenticated;
grant execute on function public.update_organization_league_mileage_plan(uuid,uuid,text) to authenticated;
