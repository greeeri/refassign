-- Connect organization setup roles and league scopes to the existing workspace.

alter table public.organization_invitations
  add column if not exists league_ids uuid[] not null default '{}'::uuid[];

create or replace function private.valid_organization_league_ids(
  p_organization_id uuid,
  p_league_ids uuid[]
) returns boolean
language sql stable security definer set search_path='' as $$
  select not exists (
    select requested.league_id
    from unnest(coalesce(p_league_ids,'{}'::uuid[])) requested(league_id)
    where not exists (
      select 1
      from public.organization_league_coverage coverage
      where coverage.organization_id=p_organization_id
        and coverage.league_id=requested.league_id
        and coverage.active
    )
  )
$$;

-- Existing assigning team members keep access to all of their organization's
-- currently configured leagues until an owner narrows the selection.
update public.organization_invitations invitation
set league_ids=(
  select coalesce(array_agg(distinct coverage.league_id),'{}'::uuid[])
  from public.organization_league_coverage coverage
  where coverage.organization_id=invitation.organization_id and coverage.active
)
where invitation.role in ('assignor','viewer') and cardinality(invitation.league_ids)=0;

drop function if exists public.create_organization_invitation(uuid,text,text,text[]);
drop function if exists private.create_organization_invitation_impl(uuid,text,text,text[]);

create function private.create_organization_invitation_impl(
  p_organization_id uuid,
  p_email text,
  p_role text,
  p_viewer_permissions text[],
  p_league_ids uuid[]
) returns uuid
language plpgsql security definer set search_path='' as $$
declare
  v_id uuid;
  v_permissions text[] := case when p_role='viewer' then coalesce(p_viewer_permissions,'{}'::text[]) else '{}'::text[] end;
  v_league_ids uuid[] := case when p_role in ('assignor','viewer') then coalesce(p_league_ids,'{}'::uuid[]) else '{}'::uuid[] end;
begin
  if (select auth.uid()) is null then raise exception 'Authentication required.'; end if;
  if not private.can_manage_organization(p_organization_id) then raise exception 'Only organization owners and administrators can invite team members.'; end if;
  if p_role not in ('admin','assignor','billing','viewer') then raise exception 'Invalid role.'; end if;
  if position('@' in coalesce(p_email,''))<2 then raise exception 'Valid email required.'; end if;
  if not private.valid_viewer_permissions(v_permissions) then raise exception 'Invalid viewer permission.'; end if;
  if p_role='viewer' and cardinality(v_permissions)=0 then raise exception 'Select at least one section for this contact.'; end if;
  if p_role in ('assignor','viewer') and cardinality(v_league_ids)=0 then raise exception 'Select at least one league.'; end if;
  if not private.valid_organization_league_ids(p_organization_id,v_league_ids) then raise exception 'A selected league is not connected to this organization.'; end if;

  insert into public.organization_invitations(organization_id,email,role,viewer_permissions,league_ids,invited_by)
  values(p_organization_id,lower(trim(p_email)),p_role,v_permissions,v_league_ids,(select auth.uid()))
  on conflict(organization_id,email) do update
    set role=excluded.role,viewer_permissions=excluded.viewer_permissions,league_ids=excluded.league_ids,
        status='pending',accepted_at=null,invited_by=excluded.invited_by,created_at=now()
  returning id into v_id;
  return v_id;
end;
$$;

create function public.create_organization_invitation(
  p_organization_id uuid,
  p_email text,
  p_role text,
  p_viewer_permissions text[] default '{}'::text[],
  p_league_ids uuid[] default '{}'::uuid[]
) returns uuid
language sql set search_path='' as $$
  select private.create_organization_invitation_impl(p_organization_id,p_email,p_role,p_viewer_permissions,p_league_ids)
$$;

create or replace function private.accept_my_organization_invitations_impl()
returns integer language plpgsql security definer set search_path='' as $$
declare
  v_email text;
  v_count integer := 0;
  invitation record;
begin
  if (select auth.uid()) is null then raise exception 'Authentication required.'; end if;
  select lower(email) into v_email from auth.users where id=(select auth.uid());

  for invitation in
    update public.organization_invitations
    set status='accepted',accepted_at=now()
    where lower(email)=v_email and status='pending'
    returning organization_id,role,viewer_permissions,league_ids
  loop
    insert into public.organization_memberships(organization_id,user_id,role,viewer_permissions)
    values(
      invitation.organization_id,(select auth.uid()),invitation.role,
      case when invitation.role='viewer' then invitation.viewer_permissions else '{}'::text[] end
    )
    on conflict(organization_id,user_id,role) do update
      set viewer_permissions=excluded.viewer_permissions;

    delete from public.organization_member_league_access
    where organization_id=invitation.organization_id and user_id=(select auth.uid());

    if invitation.role in ('assignor','viewer') then
      insert into public.organization_member_league_access(organization_id,user_id,league_id)
      select invitation.organization_id,(select auth.uid()),league_id
      from unnest(invitation.league_ids) selected(league_id)
      on conflict do nothing;
    end if;
    v_count := v_count+1;
  end loop;
  return v_count;
end;
$$;

drop function if exists public.update_organization_invitation(uuid,text,text[]);
drop function if exists private.update_organization_invitation_impl(uuid,text,text[]);

create function private.update_organization_invitation_impl(
  p_invitation_id uuid,
  p_role text,
  p_viewer_permissions text[],
  p_league_ids uuid[]
) returns void
language plpgsql security definer set search_path='' as $$
declare
  v_organization_id uuid;
  v_permissions text[] := case when p_role='viewer' then coalesce(p_viewer_permissions,'{}'::text[]) else '{}'::text[] end;
  v_league_ids uuid[] := case when p_role in ('assignor','viewer') then coalesce(p_league_ids,'{}'::uuid[]) else '{}'::uuid[] end;
begin
  if (select auth.uid()) is null then raise exception 'Authentication required.'; end if;
  select organization_id into v_organization_id from public.organization_invitations where id=p_invitation_id and status='pending';
  if v_organization_id is null then raise exception 'Pending invitation was not found.'; end if;
  if not private.can_manage_organization(v_organization_id) then raise exception 'Only organization owners and administrators can change invitations.'; end if;
  if p_role not in ('admin','assignor','billing','viewer') then raise exception 'Invalid role.'; end if;
  if not private.valid_viewer_permissions(v_permissions) then raise exception 'Invalid viewer permission.'; end if;
  if p_role='viewer' and cardinality(v_permissions)=0 then raise exception 'Select at least one section for this contact.'; end if;
  if p_role in ('assignor','viewer') and cardinality(v_league_ids)=0 then raise exception 'Select at least one league.'; end if;
  if not private.valid_organization_league_ids(v_organization_id,v_league_ids) then raise exception 'A selected league is not connected to this organization.'; end if;
  update public.organization_invitations
  set role=p_role,viewer_permissions=v_permissions,league_ids=v_league_ids
  where id=p_invitation_id;
end;
$$;

create function public.update_organization_invitation(
  p_invitation_id uuid,
  p_role text,
  p_viewer_permissions text[] default '{}'::text[],
  p_league_ids uuid[] default '{}'::uuid[]
) returns void
language sql set search_path='' as $$
  select private.update_organization_invitation_impl(p_invitation_id,p_role,p_viewer_permissions,p_league_ids)
$$;

drop function if exists public.update_organization_member_access(uuid,uuid,text,text,text[]);
drop function if exists private.update_organization_member_access_impl(uuid,uuid,text,text,text[]);

create function private.update_organization_member_access_impl(
  p_organization_id uuid,
  p_user_id uuid,
  p_current_role text,
  p_new_role text,
  p_viewer_permissions text[],
  p_league_ids uuid[]
) returns void
language plpgsql security definer set search_path='' as $$
declare
  v_permissions text[] := case when p_new_role='viewer' then coalesce(p_viewer_permissions,'{}'::text[]) else '{}'::text[] end;
  v_league_ids uuid[] := case when p_new_role in ('assignor','viewer') then coalesce(p_league_ids,'{}'::uuid[]) else '{}'::uuid[] end;
begin
  if (select auth.uid()) is null then raise exception 'Authentication required.'; end if;
  if not private.can_manage_organization(p_organization_id) then raise exception 'Only organization owners and administrators can change team access.'; end if;
  if p_current_role='owner' then raise exception 'The organization owner role cannot be changed.'; end if;
  if p_new_role not in ('admin','assignor','billing','viewer') then raise exception 'Invalid role.'; end if;
  if not private.valid_viewer_permissions(v_permissions) then raise exception 'Invalid viewer permission.'; end if;
  if p_new_role='viewer' and cardinality(v_permissions)=0 then raise exception 'Select at least one section for this contact.'; end if;
  if p_new_role in ('assignor','viewer') and cardinality(v_league_ids)=0 then raise exception 'Select at least one league.'; end if;
  if not private.valid_organization_league_ids(p_organization_id,v_league_ids) then raise exception 'A selected league is not connected to this organization.'; end if;
  if not exists(select 1 from public.organization_memberships where organization_id=p_organization_id and user_id=p_user_id and role=p_current_role) then raise exception 'Team member access was not found.'; end if;

  delete from public.organization_memberships
  where organization_id=p_organization_id and user_id=p_user_id and role=p_current_role;
  insert into public.organization_memberships(organization_id,user_id,role,viewer_permissions)
  values(p_organization_id,p_user_id,p_new_role,v_permissions)
  on conflict(organization_id,user_id,role) do update set viewer_permissions=excluded.viewer_permissions;

  delete from public.organization_member_league_access
  where organization_id=p_organization_id and user_id=p_user_id;
  if p_new_role in ('assignor','viewer') then
    insert into public.organization_member_league_access(organization_id,user_id,league_id)
    select p_organization_id,p_user_id,league_id from unnest(v_league_ids) selected(league_id)
    on conflict do nothing;
  end if;
end;
$$;

create function public.update_organization_member_access(
  p_organization_id uuid,
  p_user_id uuid,
  p_current_role text,
  p_new_role text,
  p_viewer_permissions text[] default '{}'::text[],
  p_league_ids uuid[] default '{}'::uuid[]
) returns void
language sql set search_path='' as $$
  select private.update_organization_member_access_impl(p_organization_id,p_user_id,p_current_role,p_new_role,p_viewer_permissions,p_league_ids)
$$;

create or replace function private.get_organization_team_impl(p_organization_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  if (select auth.uid()) is null then raise exception 'Authentication required.'; end if;
  if not private.can_manage_organization(p_organization_id) then raise exception 'Only organization owners and administrators can view team access.'; end if;
  return jsonb_build_object(
    'members',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',m.user_id::text||':'||m.role,'user_id',m.user_id,'email',lower(u.email),
        'role',m.role,'viewer_permissions',m.viewer_permissions,'status','active',
        'league_ids',coalesce((select jsonb_agg(a.league_id order by a.league_id) from public.organization_member_league_access a where a.organization_id=m.organization_id and a.user_id=m.user_id),'[]'::jsonb)
      ) order by case m.role when 'owner' then 0 when 'admin' then 1 when 'assignor' then 2 when 'billing' then 3 else 4 end,lower(u.email))
      from public.organization_memberships m join auth.users u on u.id=m.user_id
      where m.organization_id=p_organization_id
    ),'[]'::jsonb),
    'invitations',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',i.id,'email',lower(i.email),'role',i.role,
        'viewer_permissions',i.viewer_permissions,'league_ids',i.league_ids,'status',i.status
      ) order by i.created_at desc)
      from public.organization_invitations i
      where i.organization_id=p_organization_id and i.status='pending'
    ),'[]'::jsonb)
  );
end;
$$;

create or replace function private.get_my_test_workspaces_impl()
returns jsonb language sql stable security definer set search_path='' as $$
  with access_candidates as (
    select m.organization_id,m.role,m.viewer_permissions,
      case m.role when 'owner' then 0 when 'admin' then 1 when 'assignor' then 2 when 'billing' then 3 else 4 end priority
    from public.organization_memberships m where m.user_id=(select auth.uid())
    union all
    select oo.organization_id,'official'::text,'{}'::text[],5
    from public.organization_officials oo join public.officials f on f.id=oo.official_id
    where f.auth_user_id=(select auth.uid()) and oo.active
  ), role_groups as (
    select organization_id,role,min(priority) priority,(jsonb_agg(to_jsonb(viewer_permissions))->0) viewer_permissions
    from access_candidates group by organization_id,role
  ), access as (
    select organization_id,jsonb_agg(role order by priority)->>0 role,
      jsonb_agg(viewer_permissions order by priority)->0 viewer_permissions,
      jsonb_agg(role order by priority) roles
    from role_groups group by organization_id
  )
  select coalesce(jsonb_agg(workspace order by workspace->>'created_at' desc),'[]'::jsonb)
  from (
    select jsonb_build_object(
      'organization_id',o.id,'name',o.name,'primary_sport',o.primary_sport,'created_at',o.created_at,
      'role',access.role,'roles',access.roles,'viewer_permissions',access.viewer_permissions,
      'plan',s.plan,'official_limit',s.official_limit,'additional_official_blocks',s.additional_official_blocks,'status',s.status,
      'texting_addon',coalesce((select a.enabled from public.organization_addons a where a.organization_id=o.id and a.code='text_messaging'),false),
      'leagues',coalesce((select jsonb_agg(jsonb_build_object('league_id',l.id,'name',l.name,'region',loc.name,'coverage',c.coverage_type))
        from public.organization_league_coverage c join public.leagues l on l.id=c.league_id
        left join public.locations loc on loc.id=c.location_id
        where c.organization_id=o.id and c.active=true),'[]'::jsonb)
    ) workspace
    from access join public.organizations o on o.id=access.organization_id
    left join lateral (select * from public.refassign_subscriptions rs where rs.organization_id=o.id order by rs.created_at desc limit 1) s on true
  ) rows;
$$;

create or replace function private.current_user_roles_impl()
returns setof text language sql stable security definer set search_path='' as $$
  select distinct role from (
    select p.role::text role from public.profiles p where p.id=(select auth.uid()) and p.active
    union all
    select case when m.role in ('owner','admin') then 'admin' when m.role='assignor' then 'assignor' else 'contact' end
    from public.organization_memberships m where m.user_id=(select auth.uid())
    union all
    select 'official' from public.organization_officials oo
    join public.officials f on f.id=oo.official_id
    where f.auth_user_id=(select auth.uid()) and oo.active
  ) roles where role is not null
$$;

create or replace function public.current_user_roles()
returns setof text language sql stable set search_path='' as $$
  select * from private.current_user_roles_impl()
$$;

revoke all on function private.valid_organization_league_ids(uuid,uuid[]) from public,anon,authenticated;
revoke all on function private.create_organization_invitation_impl(uuid,text,text,text[],uuid[]) from public,anon,authenticated;
revoke all on function private.update_organization_invitation_impl(uuid,text,text[],uuid[]) from public,anon,authenticated;
revoke all on function private.update_organization_member_access_impl(uuid,uuid,text,text,text[],uuid[]) from public,anon,authenticated;
revoke all on function private.current_user_roles_impl() from public,anon,authenticated;
revoke all on function public.create_organization_invitation(uuid,text,text,text[],uuid[]) from public,anon;
revoke all on function public.update_organization_invitation(uuid,text,text[],uuid[]) from public,anon;
revoke all on function public.update_organization_member_access(uuid,uuid,text,text,text[],uuid[]) from public,anon;
revoke all on function public.current_user_roles() from public,anon;
grant execute on function public.create_organization_invitation(uuid,text,text,text[],uuid[]) to authenticated;
grant execute on function public.update_organization_invitation(uuid,text,text[],uuid[]) to authenticated;
grant execute on function public.update_organization_member_access(uuid,uuid,text,text,text[],uuid[]) to authenticated;
grant execute on function public.current_user_roles() to authenticated;
-- Public wrappers execute as the caller. Authenticated callers therefore need
-- execute on the private implementations; the private schema is not exposed
-- through the Data API, and each implementation performs its own auth check.
grant execute on function private.create_organization_invitation_impl(uuid,text,text,text[],uuid[]) to authenticated;
grant execute on function private.update_organization_invitation_impl(uuid,text,text[],uuid[]) to authenticated;
grant execute on function private.update_organization_member_access_impl(uuid,uuid,text,text,text[],uuid[]) to authenticated;
grant execute on function private.current_user_roles_impl() to authenticated;

notify pgrst,'reload schema';
