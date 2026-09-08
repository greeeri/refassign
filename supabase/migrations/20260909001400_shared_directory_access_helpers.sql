-- Shared-directory migrations can be promoted independently from the broader
-- tier workspace work, so include their minimal authorization prerequisites.

create schema if not exists private;

create or replace function private.can_access_organization(p_organization_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select exists (
    select 1
    from public.organization_memberships membership
    where membership.organization_id=p_organization_id
      and membership.user_id=(select auth.uid())
  ) or public.is_super_admin()
$$;

create or replace function private.can_manage_organization(p_organization_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select exists (
    select 1
    from public.organization_memberships membership
    where membership.organization_id=p_organization_id
      and membership.user_id=(select auth.uid())
      and membership.role in ('owner','admin','assignor')
  ) or public.is_super_admin()
$$;

revoke all on function private.can_access_organization(uuid) from public,anon;
revoke all on function private.can_manage_organization(uuid) from public,anon;
grant execute on function private.can_access_organization(uuid) to authenticated,service_role;
grant execute on function private.can_manage_organization(uuid) to authenticated,service_role;
