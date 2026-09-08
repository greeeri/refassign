alter table public.organizations
  add column if not exists primary_sport text;

drop function if exists public.create_test_organization_workspace(text,text,integer,integer,jsonb);
drop function if exists private.create_test_organization_workspace_impl(text,text,integer,integer,jsonb);
drop function if exists public.create_test_organization_workspace(text,text,text,integer,integer,jsonb);
drop function if exists private.create_test_organization_workspace_impl(text,text,text,integer,integer,jsonb);

create function private.create_test_organization_workspace_impl(
  p_organization_name text,
  p_primary_sport text,
  p_plan text,
  p_official_limit integer,
  p_additional_official_blocks integer,
  p_leagues jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_organization_id uuid;
  v_league jsonb;
  v_league_id uuid;
  v_location_id uuid;
begin
  if v_user_id is null then raise exception 'Authentication required.'; end if;
  if length(trim(coalesce(p_organization_name,''))) not between 1 and 160 then raise exception 'Organization name is required.'; end if;
  if length(trim(coalesce(p_primary_sport,''))) not between 1 and 80 then raise exception 'Primary sport is required.'; end if;
  if not exists(select 1 from public.saas_plan_definitions where code=p_plan and active=true) then raise exception 'Unknown or inactive plan.'; end if;
  if p_additional_official_blocks < 0 then raise exception 'Additional blocks cannot be negative.'; end if;
  if exists(
    select 1 from public.organizations o
    join public.organization_memberships m on m.organization_id=o.id
    where m.user_id=v_user_id and m.role='owner' and lower(trim(o.name))=lower(trim(p_organization_name))
  ) then raise exception 'You already have an organization with this name. Open the existing workspace to edit it.'; end if;

  insert into public.organizations(name,primary_sport)
  values(trim(p_organization_name),trim(p_primary_sport))
  returning id into v_organization_id;

  insert into public.organization_memberships(organization_id,user_id,role)
  values(v_organization_id,v_user_id,'owner');

  insert into public.refassign_subscriptions(user_id,organization_id,organization_name,plan,official_limit,status,founding_offer,additional_official_blocks)
  values(v_user_id,v_organization_id,trim(p_organization_name),p_plan,p_official_limit,'pending',p_plan='pro_founding',p_additional_official_blocks);

  for v_league in select value from jsonb_array_elements(coalesce(p_leagues,'[]'::jsonb)) loop
    if length(trim(coalesce(v_league->>'name',''))) > 0 then
      select id into v_league_id from public.leagues where lower(name)=lower(trim(v_league->>'name')) limit 1;
      if v_league_id is null then
        insert into public.leagues(name) values(trim(v_league->>'name')) returning id into v_league_id;
      end if;
      v_location_id:=null;
      if coalesce(v_league->>'coverage','All locations')<>'All locations' and length(trim(coalesce(v_league->>'region','')))>0 then
        select id into v_location_id from public.locations where lower(name)=lower(trim(v_league->>'region')) limit 1;
        if v_location_id is null then
          insert into public.locations(name) values(trim(v_league->>'region')) returning id into v_location_id;
        end if;
      end if;
      insert into public.organization_league_coverage(organization_id,league_id,location_id)
      values(v_organization_id,v_league_id,v_location_id)
      on conflict do nothing;
    end if;
  end loop;
  return v_organization_id;
end;
$$;

create function public.create_test_organization_workspace(
  p_organization_name text,
  p_primary_sport text,
  p_plan text,
  p_official_limit integer,
  p_additional_official_blocks integer,
  p_leagues jsonb default '[]'::jsonb
)
returns uuid
language sql
security invoker
set search_path = ''
as $$
  select private.create_test_organization_workspace_impl(p_organization_name,p_primary_sport,p_plan,p_official_limit,p_additional_official_blocks,p_leagues)
$$;

create or replace function private.update_test_organization_workspace_impl(
  p_organization_id uuid,
  p_organization_name text,
  p_primary_sport text,
  p_plan text,
  p_official_limit integer,
  p_additional_official_blocks integer,
  p_leagues jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_league jsonb;
  v_league_id uuid;
  v_location_id uuid;
  v_subscription_id uuid;
  v_current_name text;
begin
  if v_user_id is null then raise exception 'Authentication required.'; end if;
  if not private.can_manage_organization(p_organization_id) then raise exception 'Only organization owners and administrators can edit this workspace.'; end if;
  if length(trim(coalesce(p_organization_name,''))) not between 1 and 160 then raise exception 'Organization name is required.'; end if;
  if length(trim(coalesce(p_primary_sport,''))) not between 1 and 80 then raise exception 'Primary sport is required.'; end if;
  if not exists(select 1 from public.saas_plan_definitions where code=p_plan and active=true) then raise exception 'Unknown or inactive plan.'; end if;
  if p_additional_official_blocks < 0 then raise exception 'Additional blocks cannot be negative.'; end if;
  select name into v_current_name from public.organizations where id=p_organization_id;
  if lower(trim(v_current_name))<>lower(trim(p_organization_name)) and exists(
    select 1 from public.organizations o
    join public.organization_memberships m on m.organization_id=o.id
    where o.id<>p_organization_id and m.user_id=v_user_id and m.role='owner'
      and lower(trim(o.name))=lower(trim(p_organization_name))
  ) then raise exception 'You already have another organization with this name.'; end if;

  update public.organizations
  set name=trim(p_organization_name),primary_sport=trim(p_primary_sport)
  where id=p_organization_id;

  select id into v_subscription_id
  from public.refassign_subscriptions
  where organization_id=p_organization_id
  order by created_at desc
  limit 1;

  if v_subscription_id is null then
    insert into public.refassign_subscriptions(user_id,organization_id,organization_name,plan,official_limit,status,founding_offer,additional_official_blocks)
    values(v_user_id,p_organization_id,trim(p_organization_name),p_plan,p_official_limit,'pending',p_plan='pro_founding',p_additional_official_blocks);
  else
    update public.refassign_subscriptions
    set organization_name=trim(p_organization_name),plan=p_plan,official_limit=p_official_limit,
        founding_offer=(p_plan='pro_founding'),additional_official_blocks=p_additional_official_blocks
    where id=v_subscription_id;
  end if;

  delete from public.organization_league_coverage where organization_id=p_organization_id;
  for v_league in select value from jsonb_array_elements(coalesce(p_leagues,'[]'::jsonb)) loop
    if length(trim(coalesce(v_league->>'name',''))) > 0 then
      select id into v_league_id from public.leagues where lower(name)=lower(trim(v_league->>'name')) limit 1;
      if v_league_id is null then
        insert into public.leagues(name) values(trim(v_league->>'name')) returning id into v_league_id;
      end if;
      v_location_id:=null;
      if coalesce(v_league->>'coverage','All locations')<>'All locations' and length(trim(coalesce(v_league->>'region','')))>0 then
        select id into v_location_id from public.locations where lower(name)=lower(trim(v_league->>'region')) limit 1;
        if v_location_id is null then
          insert into public.locations(name) values(trim(v_league->>'region')) returning id into v_location_id;
        end if;
      end if;
      insert into public.organization_league_coverage(organization_id,league_id,location_id)
      values(p_organization_id,v_league_id,v_location_id)
      on conflict do nothing;
    end if;
  end loop;
  return p_organization_id;
end;
$$;

create or replace function public.update_test_organization_workspace(
  p_organization_id uuid,
  p_organization_name text,
  p_primary_sport text,
  p_plan text,
  p_official_limit integer,
  p_additional_official_blocks integer,
  p_leagues jsonb default '[]'::jsonb
)
returns uuid
language sql
security invoker
set search_path = ''
as $$
  select private.update_test_organization_workspace_impl(p_organization_id,p_organization_name,p_primary_sport,p_plan,p_official_limit,p_additional_official_blocks,p_leagues)
$$;

create or replace function private.get_my_test_workspaces_impl()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(workspace order by workspace->>'created_at' desc),'[]'::jsonb)
  from (
    select jsonb_build_object(
      'organization_id',o.id,'name',o.name,'primary_sport',o.primary_sport,'created_at',o.created_at,'role',m.role,
      'plan',s.plan,'official_limit',s.official_limit,'additional_official_blocks',s.additional_official_blocks,'status',s.status,
      'leagues',coalesce((select jsonb_agg(jsonb_build_object('name',l.name,'region',loc.name,'coverage',case when c.location_id is null then 'All locations' else 'Selected locations or region' end))
        from public.organization_league_coverage c join public.leagues l on l.id=c.league_id left join public.locations loc on loc.id=c.location_id where c.organization_id=o.id and c.active=true),'[]'::jsonb)
    ) workspace
    from public.organization_memberships m join public.organizations o on o.id=m.organization_id
    left join lateral (select * from public.refassign_subscriptions rs where rs.organization_id=o.id order by rs.created_at desc limit 1) s on true
    where m.user_id=(select auth.uid())
  ) rows;
$$;

revoke all on function private.create_test_organization_workspace_impl(text,text,text,integer,integer,jsonb) from public,anon;
revoke all on function private.update_test_organization_workspace_impl(uuid,text,text,text,integer,integer,jsonb) from public,anon;
revoke all on function public.create_test_organization_workspace(text,text,text,integer,integer,jsonb) from public,anon;
revoke all on function public.update_test_organization_workspace(uuid,text,text,text,integer,integer,jsonb) from public,anon;
grant usage on schema private to authenticated;
grant execute on function private.create_test_organization_workspace_impl(text,text,text,integer,integer,jsonb) to authenticated;
grant execute on function private.update_test_organization_workspace_impl(uuid,text,text,text,integer,integer,jsonb) to authenticated;
grant execute on function public.create_test_organization_workspace(text,text,text,integer,integer,jsonb) to authenticated;
grant execute on function public.update_test_organization_workspace(uuid,text,text,text,integer,integer,jsonb) to authenticated;
