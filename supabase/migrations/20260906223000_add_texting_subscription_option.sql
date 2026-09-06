create table if not exists public.organization_addons (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  code text not null check (code in ('text_messaging')),
  enabled boolean not null default false,
  unit_amount_cents integer not null check (unit_amount_cents >= 0),
  billing_interval text not null check (billing_interval in ('month')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id,code)
);

alter table public.organization_addons enable row level security;

create policy "Organization members read add-ons"
on public.organization_addons for select to authenticated
using (exists (
  select 1 from public.organization_memberships m
  where m.organization_id=organization_addons.organization_id
    and m.user_id=(select auth.uid())
));

create policy "Organization managers create add-ons"
on public.organization_addons for insert to authenticated
with check (private.can_manage_organization(organization_id));

create policy "Organization managers update add-ons"
on public.organization_addons for update to authenticated
using (private.can_manage_organization(organization_id))
with check (private.can_manage_organization(organization_id));

create policy "Organization managers delete add-ons"
on public.organization_addons for delete to authenticated
using (private.can_manage_organization(organization_id));

create or replace function private.set_organization_texting_addon_impl(
  p_organization_id uuid,
  p_enabled boolean
)
returns boolean
language plpgsql
security definer
set search_path=''
as $$
declare
  v_plan text;
  v_enabled boolean;
begin
  if (select auth.uid()) is null then raise exception 'Authentication required.'; end if;
  if not private.can_manage_organization(p_organization_id) then raise exception 'Only organization owners and administrators can manage add-ons.'; end if;

  select s.plan into v_plan
  from public.refassign_subscriptions s
  where s.organization_id=p_organization_id
  order by s.created_at desc
  limit 1;

  if v_plan is null then raise exception 'Organization subscription not found.'; end if;
  v_enabled := coalesce(p_enabled,false) and v_plan <> 'enterprise';

  insert into public.organization_addons(organization_id,code,enabled,unit_amount_cents,billing_interval)
  values(p_organization_id,'text_messaging',v_enabled,1500,'month')
  on conflict(organization_id,code) do update
  set enabled=excluded.enabled,unit_amount_cents=1500,billing_interval='month',updated_at=now();

  return v_enabled;
end;
$$;

create or replace function public.set_organization_texting_addon(
  p_organization_id uuid,
  p_enabled boolean
)
returns boolean
language sql
security invoker
set search_path=''
as $$ select private.set_organization_texting_addon_impl(p_organization_id,p_enabled) $$;

revoke all on function private.set_organization_texting_addon_impl(uuid,boolean) from public,anon;
grant execute on function private.set_organization_texting_addon_impl(uuid,boolean) to authenticated;
revoke all on function public.set_organization_texting_addon(uuid,boolean) from public,anon;
grant execute on function public.set_organization_texting_addon(uuid,boolean) to authenticated;

create or replace function private.get_my_test_workspaces_impl()
returns jsonb language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_agg(workspace order by workspace->>'created_at' desc),'[]'::jsonb)
  from (
    select jsonb_build_object(
      'organization_id',o.id,'name',o.name,'primary_sport',o.primary_sport,'created_at',o.created_at,
      'role',access.role,'viewer_permissions',access.viewer_permissions,
      'plan',s.plan,'official_limit',s.official_limit,'additional_official_blocks',s.additional_official_blocks,'status',s.status,
      'texting_addon',coalesce((select a.enabled from public.organization_addons a where a.organization_id=o.id and a.code='text_messaging'),false),
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
