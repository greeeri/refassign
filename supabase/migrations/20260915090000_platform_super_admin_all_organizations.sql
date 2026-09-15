-- Give protected platform super administrators an implicit administrative
-- workspace in every organization without changing organization ownership or
-- inserting visible organization membership rows.

create or replace function private.is_organization_owner_or_admin(
  p_organization_id uuid,
  p_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path=''
as $$
  select (
    p_user_id is not null
    and p_user_id = (select auth.uid())
    and public.is_super_admin()
  ) or exists (
    select 1
    from public.organization_memberships membership
    where membership.organization_id = p_organization_id
      and membership.user_id = p_user_id
      and membership.role in ('owner','admin')
  );
$$;

create or replace function private.get_my_test_workspaces_impl()
returns jsonb
language sql
stable
security definer
set search_path=''
as $$
  with access as (
    select
      organization.id as organization_id,
      case
        when public.is_super_admin()
          and access_profile.user_id is null
          and not exists (
            select 1
            from public.organization_memberships membership
            where membership.organization_id = organization.id
              and membership.user_id = (select auth.uid())
          )
          then array['admin']::text[]
        else coalesce(access_profile.roles,'{}'::text[])
          || case when exists (
            select 1
            from public.organization_memberships membership
            where membership.organization_id = organization.id
              and membership.user_id = (select auth.uid())
              and membership.role = 'owner'
          ) then array['owner']::text[] else '{}'::text[] end
      end as roles,
      coalesce(access_profile.viewer_permissions,'{}'::text[]) as viewer_permissions
    from public.organizations organization
    left join public.organization_user_access_profiles access_profile
      on access_profile.organization_id = organization.id
     and access_profile.user_id = (select auth.uid())
    where public.is_super_admin()
       or access_profile.user_id is not null
       or exists (
         select 1
         from public.organization_memberships membership
         where membership.organization_id = organization.id
           and membership.user_id = (select auth.uid())
       )
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'organization_id',organization.id,
        'name',organization.name,
        'primary_sport',organization.primary_sport,
        'created_at',organization.created_at,
        'role',coalesce((access.roles)[1],'official'),
        'roles',access.roles,
        'viewer_permissions',access.viewer_permissions,
        'plan',subscription.plan,
        'official_limit',subscription.official_limit,
        'additional_official_blocks',subscription.additional_official_blocks,
        'status',subscription.status,
        'texting_addon',coalesce((
          select addon.enabled
          from public.organization_addons addon
          where addon.organization_id = organization.id
            and addon.code = 'text_messaging'
        ),false),
        'leagues',coalesce((
          select jsonb_agg(jsonb_build_object('league_id',league.id,'name',league.name))
          from public.organization_league_coverage coverage
          join public.leagues league on league.id = coverage.league_id
          where coverage.organization_id = organization.id
            and coverage.active
        ),'[]'::jsonb)
      ) order by organization.created_at desc
    ),
    '[]'::jsonb
  )
  from access
  join public.organizations organization on organization.id = access.organization_id
  left join lateral (
    select *
    from public.refassign_subscriptions latest_subscription
    where latest_subscription.organization_id = organization.id
    order by latest_subscription.created_at desc
    limit 1
  ) subscription on true;
$$;

revoke all on function private.is_organization_owner_or_admin(uuid,uuid) from public,anon;
revoke all on function private.get_my_test_workspaces_impl() from public,anon;
grant execute on function private.is_organization_owner_or_admin(uuid,uuid) to authenticated;
grant execute on function private.get_my_test_workspaces_impl() to authenticated;

notify pgrst,'reload schema';
