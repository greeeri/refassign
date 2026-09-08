-- Let invited officials activate one account and use it across every
-- organization that has connected their official record.

create or replace function private.accept_my_official_invitations_impl()
returns integer language plpgsql security definer set search_path='' as $$
declare
  v_email text;
  v_first_name text;
  v_last_name text;
  v_full_name text;
  v_count integer := 0;
begin
  select lower(email),
    nullif(trim(raw_user_meta_data->>'first_name'),''),
    nullif(trim(raw_user_meta_data->>'last_name'),''),
    nullif(trim(coalesce(raw_user_meta_data->>'full_name',raw_user_meta_data->>'name','')),'')
  into v_email,v_first_name,v_last_name,v_full_name
  from auth.users where id=(select auth.uid());

  if v_first_name is null and v_full_name is not null then
    v_first_name := split_part(v_full_name,' ',1);
  end if;
  if v_last_name is null and v_full_name is not null and position(' ' in v_full_name)>0 then
    v_last_name := trim(substr(v_full_name,position(' ' in v_full_name)+1));
  end if;

  update public.officials
  set auth_user_id=(select auth.uid()),
      first_name=coalesce(nullif(trim(first_name),''),v_first_name,''),
      last_name=coalesce(nullif(trim(last_name),''),v_last_name,''),
      full_name=coalesce(nullif(trim(full_name),''),v_full_name,v_email)
  where lower(email)=v_email and (auth_user_id is null or auth_user_id=(select auth.uid()));

  update public.organization_official_invitations
  set status='accepted',accepted_at=coalesce(accepted_at,now())
  where lower(email)=v_email and status='pending';
  get diagnostics v_count=row_count;
  return v_count;
end $$;

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
  ), access as (
    select distinct on (organization_id) organization_id,role,viewer_permissions
    from access_candidates order by organization_id,priority
  )
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
    from access join public.organizations o on o.id=access.organization_id
    left join lateral (select * from public.refassign_subscriptions rs where rs.organization_id=o.id order by rs.created_at desc limit 1) s on true
  ) rows;
$$;

create or replace function private.set_organization_official_name_impl(
  p_organization_id uuid,p_email text,p_first_name text,p_last_name text
) returns boolean language plpgsql security definer set search_path='' as $$
begin
  if (select auth.uid()) is null or not private.can_manage_organization(p_organization_id) then
    raise exception 'Not authorized.';
  end if;
  if length(trim(coalesce(p_first_name,'')))<1 or length(trim(coalesce(p_last_name,'')))<1 then
    raise exception 'First and last name are required.';
  end if;
  update public.officials o
  set first_name=trim(p_first_name),last_name=trim(p_last_name),
      full_name=trim(p_first_name)||' '||trim(p_last_name)
  where lower(o.email)=lower(trim(p_email)) and exists (
    select 1 from public.organization_officials oo
    where oo.organization_id=p_organization_id and oo.official_id=o.id and oo.active
  );
  return found;
end $$;

create or replace function public.set_organization_official_name(
  p_organization_id uuid,p_email text,p_first_name text,p_last_name text
) returns boolean language sql security invoker set search_path='' as $$
  select private.set_organization_official_name_impl(p_organization_id,p_email,p_first_name,p_last_name)
$$;

revoke all on function private.set_organization_official_name_impl(uuid,text,text,text) from public,anon;
revoke all on function public.set_organization_official_name(uuid,text,text,text) from public,anon;
grant execute on function private.set_organization_official_name_impl(uuid,text,text,text) to authenticated;
grant execute on function public.set_organization_official_name(uuid,text,text,text) to authenticated;
