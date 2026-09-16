-- Assignors may maintain settings only for leagues explicitly assigned to them.
-- Owners, administrators, and platform super admins retain organization-wide access.
create or replace function private.can_manage_organization_league_settings(
  p_organization_id uuid,
  p_league_id uuid
) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_super_admin() or (
    private.organization_has_operational_access(p_organization_id)
    and (
      exists (
        select 1
        from public.organization_memberships membership
        where membership.organization_id = p_organization_id
          and membership.user_id = (select auth.uid())
          and membership.role in ('owner', 'admin')
      )
      or exists (
        select 1
        from public.organization_memberships membership
        join public.organization_member_league_access access
          on access.organization_id = membership.organization_id
         and access.user_id = membership.user_id
         and access.league_id = p_league_id
        where membership.organization_id = p_organization_id
          and membership.user_id = (select auth.uid())
          and membership.role = 'assignor'
      )
    )
    and exists (
      select 1
      from public.organization_league_coverage coverage
      where coverage.organization_id = p_organization_id
        and coverage.league_id = p_league_id
        and coverage.active
    )
  );
$$;

revoke all on function private.can_manage_organization_league_settings(uuid, uuid)
  from public, anon;
grant execute on function private.can_manage_organization_league_settings(uuid, uuid)
  to authenticated, service_role;

create or replace function public.can_manage_assigned_league_settings(
  p_league_id uuid
) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null and exists (
    select 1
    from public.organization_league_coverage coverage
    where coverage.league_id = p_league_id
      and coverage.active
      and private.can_manage_organization_league_settings(
        coverage.organization_id,
        coverage.league_id
      )
  );
$$;

revoke all on function public.can_manage_assigned_league_settings(uuid)
  from public, anon;
grant execute on function public.can_manage_assigned_league_settings(uuid)
  to authenticated, service_role;

create or replace function private.update_organization_league_mileage_plan_impl(
  p_organization_id uuid,
  p_league_id uuid,
  p_mileage_plan text
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null
     or not private.can_manage_organization_league_settings(
       p_organization_id,
       p_league_id
     ) then
    raise exception 'You may update only leagues assigned to you.' using errcode = '42501';
  end if;

  if p_mileage_plan not in ('one_way', 'round_trip', 'actual', 'none') then
    raise exception 'Invalid mileage plan.';
  end if;

  update public.leagues
  set mileage_plan = p_mileage_plan
  where id = p_league_id;
  return found;
end;
$$;

create or replace function private.get_or_create_league_connection_link_impl(
  p_organization_id uuid,
  p_league_id uuid,
  p_regenerate boolean default false
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token uuid;
begin
  if (select auth.uid()) is null
     or not private.can_manage_organization_league_settings(
       p_organization_id,
       p_league_id
     ) then
    raise exception 'You may create links only for leagues assigned to you.'
      using errcode = '42501';
  end if;

  insert into public.league_official_connection_links (
    organization_id,
    league_id,
    created_by
  ) values (
    p_organization_id,
    p_league_id,
    (select auth.uid())
  )
  on conflict (organization_id, league_id) do update
  set token = case
        when p_regenerate then gen_random_uuid()
        else public.league_official_connection_links.token
      end,
      active = true,
      updated_at = now(),
      created_by = case
        when p_regenerate then (select auth.uid())
        else public.league_official_connection_links.created_by
      end
  returning token into v_token;

  return v_token;
end;
$$;

create or replace function private.get_organization_setup_directory_impl(
  p_organization_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null
     or not private.can_access_organization(p_organization_id) then
    raise exception 'Not authorized.';
  end if;

  return jsonb_build_object(
    'leagues', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', league.id,
          'name', league.name,
          'mileage_plan', league.mileage_plan
        ) order by league.name
      )
      from public.organization_league_coverage link
      join public.leagues league on league.id = link.league_id
      where link.organization_id = p_organization_id
        and link.active
        and league.active
        and private.can_manage_organization_league_settings(
          p_organization_id,
          league.id
        )
    ), '[]'::jsonb),
    'levels', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', level.id,
          'name', level.name,
          'officials_needed', level.officials_needed
        ) order by level.name
      )
      from public.organization_levels link
      join public.levels level on level.id = link.level_id
      where link.organization_id = p_organization_id
        and link.active
        and level.active
    ), '[]'::jsonb),
    'teams', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', team.id,
          'name', team.name,
          'sport_id', team.sport_id,
          'level_id', team.level_id,
          'level', team.level
        ) order by team.name
      )
      from public.organization_teams link
      join public.teams team on team.id = link.team_id
      where link.organization_id = p_organization_id
        and link.active
        and team.active
    ), '[]'::jsonb)
  );
end;
$$;

drop policy if exists "Staff add league documents" on public.league_documents;
create policy "Assigned league managers add league documents"
on public.league_documents for insert to authenticated
with check (
  public.can_manage_assigned_league_settings(league_id)
  and uploaded_by = (select auth.uid())
);

drop policy if exists "Staff remove league documents" on public.league_documents;
create policy "Assigned league managers remove league documents"
on public.league_documents for delete to authenticated
using (public.can_manage_assigned_league_settings(league_id));

drop policy if exists "Staff upload league files" on storage.objects;
create policy "Assigned league managers upload league files"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'league-documents'
  and exists (
    select 1
    from public.leagues league
    where league.id::text = (storage.foldername(name))[1]
      and public.can_manage_assigned_league_settings(league.id)
  )
);

drop policy if exists "Staff remove league files" on storage.objects;
create policy "Assigned league managers remove league files"
on storage.objects for delete to authenticated
using (
  bucket_id = 'league-documents'
  and exists (
    select 1
    from public.leagues league
    where league.id::text = (storage.foldername(name))[1]
      and public.can_manage_assigned_league_settings(league.id)
  )
);

notify pgrst, 'reload schema';
