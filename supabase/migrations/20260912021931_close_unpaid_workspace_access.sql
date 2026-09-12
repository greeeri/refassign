-- Preserve only the two QA organizations that existed before subscription
-- enforcement. This one-time insert does not grant future organizations access
-- based on their name.
insert into public.refassign_subscriptions (
  user_id,
  organization_id,
  organization_name,
  plan,
  official_limit,
  status,
  access_override,
  access_override_reason,
  access_overridden_at
)
select distinct on (organization.id)
  membership.user_id,
  organization.id,
  organization.name,
  'starter',
  50,
  'canceled',
  true,
  'Internal QA organization retained during paid-access enforcement',
  now()
from public.organizations organization
join public.organization_memberships membership
  on membership.organization_id = organization.id
 and membership.role in ('owner', 'admin')
where organization.name in ('Test', 'Test 2')
  and not exists (
    select 1
    from public.refassign_subscriptions existing
    where existing.organization_id = organization.id
  )
order by organization.id,
  case membership.role when 'owner' then 0 else 1 end;

-- Operational access is fail-closed: a missing subscription is not a paid
-- subscription.
create or replace function private.organization_has_operational_access(p_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    coalesce((
      select subscription.access_override
          or subscription.status in ('active', 'trialing')
      from public.refassign_subscriptions subscription
      where subscription.organization_id = p_organization_id
      order by subscription.created_at desc
      limit 1
    ), false);
$$;

revoke all on function private.organization_has_operational_access(uuid)
  from public, anon;
grant execute on function private.organization_has_operational_access(uuid)
  to authenticated;

-- Do not let a legacy profile or organization membership restore UI roles for
-- an organization whose Stripe subscription is unpaid.
create or replace function private.current_user_roles_impl()
returns setof text
language sql
stable
security definer
set search_path = ''
as $$
  select distinct role
  from (
    select profile.role::text role
    from public.profiles profile
    where profile.id = (select auth.uid())
      and profile.active
      and (
        public.is_super_admin()
        or exists (
          select 1
          from public.organization_memberships membership
          where membership.user_id = (select auth.uid())
            and private.organization_has_operational_access(membership.organization_id)
        )
        or exists (
          select 1
          from public.organization_officials organization_official
          join public.officials official
            on official.id = organization_official.official_id
          where official.auth_user_id = (select auth.uid())
            and organization_official.active
            and private.organization_has_operational_access(organization_official.organization_id)
        )
      )
    union all
    select case
      when membership.role in ('owner', 'admin') then 'admin'
      when membership.role = 'assignor' then 'assignor'
      else 'contact'
    end
    from public.organization_memberships membership
    where membership.user_id = (select auth.uid())
      and private.organization_has_operational_access(membership.organization_id)
    union all
    select 'official'
    from public.organization_officials organization_official
    join public.officials official
      on official.id = organization_official.official_id
    where official.auth_user_id = (select auth.uid())
      and organization_official.active
      and private.organization_has_operational_access(organization_official.organization_id)
  ) roles
  where role is not null;
$$;

revoke all on function private.current_user_roles_impl()
  from public, anon, authenticated;
grant execute on function private.current_user_roles_impl()
  to authenticated;

notify pgrst, 'reload schema';
