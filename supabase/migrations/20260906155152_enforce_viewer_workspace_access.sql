create or replace function private.get_my_test_workspaces_impl()
returns jsonb language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_agg(workspace order by workspace->>'created_at' desc),'[]'::jsonb)
  from (
    select jsonb_build_object(
      'organization_id',o.id,'name',o.name,'primary_sport',o.primary_sport,'created_at',o.created_at,
      'role',access.role,'viewer_permissions',access.viewer_permissions,
      'plan',s.plan,'official_limit',s.official_limit,'additional_official_blocks',s.additional_official_blocks,'status',s.status,
      'leagues',coalesce((select jsonb_agg(jsonb_build_object('name',l.name,'region',loc.name,
        'coverage',case when c.location_id is null then 'All locations' else 'Selected locations or region' end))
        from public.organization_league_coverage c join public.leagues l on l.id=c.league_id
        left join public.locations loc on loc.id=c.location_id
        where c.organization_id=o.id and c.active=true),'[]'::jsonb)
    ) workspace
    from (select distinct organization_id from public.organization_memberships where user_id=(select auth.uid())) mine
    join public.organizations o on o.id=mine.organization_id
    join lateral (
      select m.role,m.viewer_permissions from public.organization_memberships m
      where m.organization_id=o.id and m.user_id=(select auth.uid())
      order by case m.role when 'owner' then 0 when 'admin' then 1 when 'assignor' then 2 when 'billing' then 3 else 4 end limit 1
    ) access on true
    left join lateral (select * from public.refassign_subscriptions rs where rs.organization_id=o.id order by rs.created_at desc limit 1) s on true
  ) rows;
$$;
