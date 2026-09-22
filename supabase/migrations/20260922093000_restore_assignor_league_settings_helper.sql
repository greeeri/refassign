-- Production did not contain the scoped league-settings helper introduced by
-- the earlier assignor access migration. Restore it before directory functions
-- and league-specific settings call it.
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
9dd97260ac1e86e68b0910d7536319b795700231