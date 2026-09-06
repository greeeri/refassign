alter table public.organization_league_coverage
  add column if not exists coverage_type text;

update public.organization_league_coverage
set coverage_type=case when location_id is null then 'All locations' else 'Selected locations only' end
where coverage_type is null;

alter table public.organization_league_coverage
  alter column coverage_type set default 'All locations',
  alter column coverage_type set not null;

alter table public.organization_league_coverage
  drop constraint if exists organization_league_coverage_coverage_type_check;
alter table public.organization_league_coverage
  add constraint organization_league_coverage_coverage_type_check
  check (coverage_type in ('All locations','Selected locations only','Shared by region'));

create or replace function private.set_organization_coverage_types_impl(
  p_organization_id uuid,
  p_leagues jsonb
)
returns integer
language plpgsql
security definer
set search_path=''
as $$
declare
  v_league jsonb;
  v_coverage text;
  v_count integer := 0;
begin
  if (select auth.uid()) is null then raise exception 'Authentication required.'; end if;
  if not private.can_manage_organization(p_organization_id) then raise exception 'Only organization owners and administrators can edit coverage.'; end if;

  for v_league in select value from jsonb_array_elements(coalesce(p_leagues,'[]'::jsonb)) loop
    v_coverage := coalesce(v_league->>'coverage','All locations');
    if v_coverage not in ('All locations','Selected locations only','Shared by region') then
      raise exception 'Invalid assignor coverage type.';
    end if;
    update public.organization_league_coverage c
    set coverage_type=v_coverage
    from public.leagues l
    where c.organization_id=p_organization_id
      and c.league_id=l.id
      and lower(l.name)=lower(trim(v_league->>'name'));
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

create or replace function public.set_organization_coverage_types(
  p_organization_id uuid,
  p_leagues jsonb
)
returns integer
language sql
security invoker
set search_path=''
as $$ select private.set_organization_coverage_types_impl(p_organization_id,p_leagues) $$;

revoke all on function private.set_organization_coverage_types_impl(uuid,jsonb) from public,anon;
grant execute on function private.set_organization_coverage_types_impl(uuid,jsonb) to authenticated;
revoke all on function public.set_organization_coverage_types(uuid,jsonb) from public,anon;
grant execute on function public.set_organization_coverage_types(uuid,jsonb) to authenticated;

create or replace function private.get_my_test_workspaces_impl()
returns jsonb language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_agg(workspace order by workspace->>'created_at' desc),'[]'::jsonb)
  from (
    select jsonb_build_object(
      'organization_id',o.id,'name',o.name,'primary_sport',o.primary_sport,'created_at',o.created_at,
      'role',access.role,'viewer_permissions',access.viewer_permissions,
      'plan',s.plan,'official_limit',s.official_limit,'additional_official_blocks',s.additional_official_blocks,'status',s.status,
      'texting_addon',coalesce((select a.enabled from public.organization_addons a where a.organization_id=o.id and a.code='text_messaging'),false),
      'leagues',coalesce((select jsonb_agg(jsonb_build_object('name',l.name,'region',loc.name,'coverage',c.coverage_type))
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
