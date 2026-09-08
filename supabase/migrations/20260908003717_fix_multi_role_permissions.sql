-- Avoid PostgreSQL multidimensional-array aggregation when a user has roles
-- with different viewer permission counts in the same organization.

create or replace function private.get_my_test_workspaces_impl()
returns jsonb language sql stable security definer set search_path='' as $$
  with access_candidates as (
    select m.organization_id,m.role,m.viewer_permissions,
      case m.role when 'owner' then 0 when 'admin' then 1 when 'assignor' then 2 when 'billing' then 3 else 4 end priority
    from public.organization_memberships m
    where m.user_id=(select auth.uid())
    union all
    select oo.organization_id,'official'::text,'{}'::text[],5
    from public.organization_officials oo
    join public.officials f on f.id=oo.official_id
    where f.auth_user_id=(select auth.uid()) and oo.active
  ), role_groups as (
    select organization_id,role,min(priority) priority,
      (jsonb_agg(to_jsonb(viewer_permissions))->0) viewer_permissions
    from access_candidates
    group by organization_id,role
  ), access as (
    select organization_id,
      jsonb_agg(role order by priority)->>0 role,
      jsonb_agg(viewer_permissions order by priority)->0 viewer_permissions,
      jsonb_agg(role order by priority) roles
    from role_groups
    group by organization_id
  )
  select coalesce(jsonb_agg(workspace order by workspace->>'created_at' desc),'[]'::jsonb)
  from (
    select jsonb_build_object(
      'organization_id',o.id,'name',o.name,'primary_sport',o.primary_sport,'created_at',o.created_at,
      'role',access.role,'roles',access.roles,'viewer_permissions',access.viewer_permissions,
      'plan',s.plan,'official_limit',s.official_limit,'additional_official_blocks',s.additional_official_blocks,'status',s.status,
      'texting_addon',coalesce((select a.enabled from public.organization_addons a where a.organization_id=o.id and a.code='text_messaging'),false),
      'leagues',coalesce((select jsonb_agg(jsonb_build_object('name',l.name,'region',loc.name,'coverage',c.coverage_type))
        from public.organization_league_coverage c join public.leagues l on l.id=c.league_id
        left join public.locations loc on loc.id=c.location_id
        where c.organization_id=o.id and c.active=true),'[]'::jsonb)
    ) workspace
    from access join public.organizations o on o.id=access.organization_id
    left join lateral (select * from public.refassign_subscriptions rs where rs.organization_id=o.id order by rs.created_at desc limit 1) s on true
  ) rows;
$$;
