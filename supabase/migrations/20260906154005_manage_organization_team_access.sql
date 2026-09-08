alter table public.organization_invitations
  add column if not exists viewer_permissions text[] not null default '{}'::text[];

alter table public.organization_memberships
  add column if not exists viewer_permissions text[] not null default '{}'::text[];

create or replace function private.valid_viewer_permissions(p_permissions text[])
returns boolean
language sql
immutable
security invoker
set search_path = ''
as $$
  select not exists (
    select 1
    from unnest(coalesce(p_permissions, '{}'::text[])) permission
    where permission <> all(array[
      'overview','leagues','games','assignments','officials','reporting',
      'analytics','payroll','billing','training_documents'
    ]::text[])
  )
$$;

drop function if exists public.create_organization_invitation(uuid,text,text);
drop function if exists private.create_organization_invitation_impl(uuid,text,text);
drop function if exists public.create_organization_invitation(uuid,text,text,text[]);
drop function if exists private.create_organization_invitation_impl(uuid,text,text,text[]);

create function private.create_organization_invitation_impl(
  p_organization_id uuid,
  p_email text,
  p_role text,
  p_viewer_permissions text[]
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_permissions text[] := case when p_role='viewer' then coalesce(p_viewer_permissions,'{}'::text[]) else '{}'::text[] end;
begin
  if (select auth.uid()) is null then raise exception 'Authentication required.'; end if;
  if not private.can_manage_organization(p_organization_id) then raise exception 'Only organization owners and administrators can invite team members.'; end if;
  if p_role not in ('admin','assignor','billing','viewer') then raise exception 'Invalid role.'; end if;
  if position('@' in coalesce(p_email,''))<2 then raise exception 'Valid email required.'; end if;
  if not private.valid_viewer_permissions(v_permissions) then raise exception 'Invalid viewer permission.'; end if;
  if p_role='viewer' and cardinality(v_permissions)=0 then raise exception 'Select at least one section for this viewer.'; end if;

  insert into public.organization_invitations(organization_id,email,role,viewer_permissions,invited_by)
  values(p_organization_id,lower(trim(p_email)),p_role,v_permissions,(select auth.uid()))
  on conflict(organization_id,email) do update
    set role=excluded.role,viewer_permissions=excluded.viewer_permissions,status='pending',accepted_at=null,
        invited_by=excluded.invited_by,created_at=now()
  returning id into v_id;
  return v_id;
end;
$$;

create function public.create_organization_invitation(
  p_organization_id uuid,
  p_email text,
  p_role text,
  p_viewer_permissions text[] default '{}'::text[]
)
returns uuid
language sql
security invoker
set search_path = ''
as $$
  select private.create_organization_invitation_impl(p_organization_id,p_email,p_role,p_viewer_permissions)
$$;

create or replace function private.accept_my_organization_invitations_impl()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text;
  v_count integer;
begin
  if (select auth.uid()) is null then raise exception 'Authentication required.'; end if;
  select lower(email) into v_email from auth.users where id=(select auth.uid());
  with accepted as (
    update public.organization_invitations
    set status='accepted',accepted_at=now()
    where lower(email)=v_email and status='pending'
    returning organization_id,role,viewer_permissions
  ), inserted as (
    insert into public.organization_memberships(organization_id,user_id,role,viewer_permissions)
    select organization_id,(select auth.uid()),role,
           case when role='viewer' then viewer_permissions else '{}'::text[] end
    from accepted
    on conflict(organization_id,user_id,role) do update
      set viewer_permissions=excluded.viewer_permissions
    returning 1
  )
  select count(*) into v_count from inserted;
  return v_count;
end;
$$;

create or replace function private.get_organization_team_impl(p_organization_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then raise exception 'Authentication required.'; end if;
  if not private.can_manage_organization(p_organization_id) then raise exception 'Only organization owners and administrators can view team access.'; end if;
  return jsonb_build_object(
    'members',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',m.user_id::text||':'||m.role,'user_id',m.user_id,'email',lower(u.email),
        'role',m.role,'viewer_permissions',m.viewer_permissions,'status','active'
      ) order by case m.role when 'owner' then 0 when 'admin' then 1 when 'assignor' then 2 when 'billing' then 3 else 4 end,lower(u.email))
      from public.organization_memberships m join auth.users u on u.id=m.user_id
      where m.organization_id=p_organization_id
    ),'[]'::jsonb),
    'invitations',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',i.id,'email',lower(i.email),'role',i.role,
        'viewer_permissions',i.viewer_permissions,'status',i.status
      ) order by i.created_at desc)
      from public.organization_invitations i
      where i.organization_id=p_organization_id and i.status='pending'
    ),'[]'::jsonb)
  );
end;
$$;

create or replace function private.update_organization_member_access_impl(
  p_organization_id uuid,p_user_id uuid,p_current_role text,p_new_role text,p_viewer_permissions text[]
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_permissions text[] := case when p_new_role='viewer' then coalesce(p_viewer_permissions,'{}'::text[]) else '{}'::text[] end;
begin
  if (select auth.uid()) is null then raise exception 'Authentication required.'; end if;
  if not private.can_manage_organization(p_organization_id) then raise exception 'Only organization owners and administrators can change team access.'; end if;
  if p_current_role='owner' then raise exception 'The organization owner role cannot be changed.'; end if;
  if p_new_role not in ('admin','assignor','billing','viewer') then raise exception 'Invalid role.'; end if;
  if not private.valid_viewer_permissions(v_permissions) then raise exception 'Invalid viewer permission.'; end if;
  if p_new_role='viewer' and cardinality(v_permissions)=0 then raise exception 'Select at least one section for this viewer.'; end if;
  if not exists(select 1 from public.organization_memberships where organization_id=p_organization_id and user_id=p_user_id and role=p_current_role) then raise exception 'Team member access was not found.'; end if;

  delete from public.organization_memberships
  where organization_id=p_organization_id and user_id=p_user_id and role=p_current_role;
  insert into public.organization_memberships(organization_id,user_id,role,viewer_permissions)
  values(p_organization_id,p_user_id,p_new_role,v_permissions)
  on conflict(organization_id,user_id,role) do update set viewer_permissions=excluded.viewer_permissions;
end;
$$;

create or replace function public.update_organization_member_access(
  p_organization_id uuid,p_user_id uuid,p_current_role text,p_new_role text,p_viewer_permissions text[] default '{}'::text[]
)
returns void language sql security invoker set search_path=''
as $$ select private.update_organization_member_access_impl(p_organization_id,p_user_id,p_current_role,p_new_role,p_viewer_permissions) $$;

create or replace function private.remove_organization_member_impl(p_organization_id uuid,p_user_id uuid,p_role text)
returns void language plpgsql security definer set search_path='' as $$
begin
  if (select auth.uid()) is null then raise exception 'Authentication required.'; end if;
  if not private.can_manage_organization(p_organization_id) then raise exception 'Only organization owners and administrators can remove team access.'; end if;
  if p_role='owner' then raise exception 'The organization owner cannot be removed.'; end if;
  delete from public.organization_memberships where organization_id=p_organization_id and user_id=p_user_id and role=p_role;
end;
$$;

create or replace function public.remove_organization_member(p_organization_id uuid,p_user_id uuid,p_role text)
returns void language sql security invoker set search_path=''
as $$ select private.remove_organization_member_impl(p_organization_id,p_user_id,p_role) $$;

create or replace function private.update_organization_invitation_impl(p_invitation_id uuid,p_role text,p_viewer_permissions text[])
returns void language plpgsql security definer set search_path='' as $$
declare
  v_organization_id uuid;
  v_permissions text[] := case when p_role='viewer' then coalesce(p_viewer_permissions,'{}'::text[]) else '{}'::text[] end;
begin
  if (select auth.uid()) is null then raise exception 'Authentication required.'; end if;
  select organization_id into v_organization_id from public.organization_invitations where id=p_invitation_id and status='pending';
  if v_organization_id is null then raise exception 'Pending invitation was not found.'; end if;
  if not private.can_manage_organization(v_organization_id) then raise exception 'Only organization owners and administrators can change invitations.'; end if;
  if p_role not in ('admin','assignor','billing','viewer') then raise exception 'Invalid role.'; end if;
  if not private.valid_viewer_permissions(v_permissions) then raise exception 'Invalid viewer permission.'; end if;
  if p_role='viewer' and cardinality(v_permissions)=0 then raise exception 'Select at least one section for this viewer.'; end if;
  update public.organization_invitations set role=p_role,viewer_permissions=v_permissions where id=p_invitation_id;
end;
$$;

create or replace function public.update_organization_invitation(p_invitation_id uuid,p_role text,p_viewer_permissions text[] default '{}'::text[])
returns void language sql security invoker set search_path=''
as $$ select private.update_organization_invitation_impl(p_invitation_id,p_role,p_viewer_permissions) $$;

create or replace function private.revoke_organization_invitation_impl(p_invitation_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare v_organization_id uuid;
begin
  if (select auth.uid()) is null then raise exception 'Authentication required.'; end if;
  select organization_id into v_organization_id from public.organization_invitations where id=p_invitation_id and status='pending';
  if v_organization_id is null then raise exception 'Pending invitation was not found.'; end if;
  if not private.can_manage_organization(v_organization_id) then raise exception 'Only organization owners and administrators can revoke invitations.'; end if;
  update public.organization_invitations set status='revoked' where id=p_invitation_id;
end;
$$;

create or replace function public.revoke_organization_invitation(p_invitation_id uuid)
returns void language sql security invoker set search_path=''
as $$ select private.revoke_organization_invitation_impl(p_invitation_id) $$;

revoke all on function private.valid_viewer_permissions(text[]) from public,anon;
revoke all on function private.create_organization_invitation_impl(uuid,text,text,text[]) from public,anon;
revoke all on function private.update_organization_member_access_impl(uuid,uuid,text,text,text[]) from public,anon;
revoke all on function private.remove_organization_member_impl(uuid,uuid,text) from public,anon;
revoke all on function private.update_organization_invitation_impl(uuid,text,text[]) from public,anon;
revoke all on function private.revoke_organization_invitation_impl(uuid) from public,anon;
revoke all on function public.create_organization_invitation(uuid,text,text,text[]) from public,anon;
revoke all on function public.update_organization_member_access(uuid,uuid,text,text,text[]) from public,anon;
revoke all on function public.remove_organization_member(uuid,uuid,text) from public,anon;
revoke all on function public.update_organization_invitation(uuid,text,text[]) from public,anon;
revoke all on function public.revoke_organization_invitation(uuid) from public,anon;
grant usage on schema private to authenticated;
grant execute on function private.create_organization_invitation_impl(uuid,text,text,text[]) to authenticated;
grant execute on function private.update_organization_member_access_impl(uuid,uuid,text,text,text[]) to authenticated;
grant execute on function private.remove_organization_member_impl(uuid,uuid,text) to authenticated;
grant execute on function private.update_organization_invitation_impl(uuid,text,text[]) to authenticated;
grant execute on function private.revoke_organization_invitation_impl(uuid) to authenticated;
grant execute on function public.create_organization_invitation(uuid,text,text,text[]) to authenticated;
grant execute on function public.update_organization_member_access(uuid,uuid,text,text,text[]) to authenticated;
grant execute on function public.remove_organization_member(uuid,uuid,text) to authenticated;
grant execute on function public.update_organization_invitation(uuid,text,text[]) to authenticated;
grant execute on function public.revoke_organization_invitation(uuid) to authenticated;
