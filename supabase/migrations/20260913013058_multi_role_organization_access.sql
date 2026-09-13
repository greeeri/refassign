alter table public.organization_memberships drop constraint if exists organization_memberships_role_check;
alter table public.organization_memberships add constraint organization_memberships_role_check
check (role in ('owner','admin','assignor','billing','viewer','mentor','registrar'));

alter table public.organization_invitations add column if not exists roles text[] not null default '{}'::text[];
update public.organization_invitations set roles=array[role] where cardinality(roles)=0;

create table if not exists public.organization_user_access_profiles(
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  roles text[] not null default '{}'::text[],
  viewer_permissions text[] not null default '{}'::text[],
  league_ids uuid[] not null default '{}'::uuid[],
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  primary key(organization_id,user_id),
  check (roles <@ array['admin','assignor','official','mentor','registrar','viewer','billing']::text[])
);
alter table public.organization_user_access_profiles enable row level security;
grant select on public.organization_user_access_profiles to authenticated;
create policy "Users read own multi role access" on public.organization_user_access_profiles
for select to authenticated using(user_id=(select auth.uid()) or private.is_organization_owner_or_admin(organization_id,(select auth.uid())));

insert into public.organization_user_access_profiles(organization_id,user_id,roles,viewer_permissions,league_ids)
select m.organization_id,m.user_id,
  coalesce(array_agg(distinct m.role) filter(where m.role<>'owner'),'{}'::text[]),
  coalesce((select m2.viewer_permissions from public.organization_memberships m2 where m2.organization_id=m.organization_id and m2.user_id=m.user_id and m2.role='viewer' limit 1),'{}'::text[]),
  coalesce((select array_agg(a.league_id) from public.organization_member_league_access a where a.organization_id=m.organization_id and a.user_id=m.user_id),'{}'::uuid[])
from public.organization_memberships m group by m.organization_id,m.user_id
on conflict do nothing;

create or replace function private.sync_organization_user_roles(
  p_organization_id uuid,p_user_id uuid,p_roles text[],p_viewer_permissions text[],p_league_ids uuid[]
) returns void language plpgsql security definer set search_path='' as $$
declare v_roles text[]:=coalesce(p_roles,'{}'::text[]);v_email text;v_official_id uuid;
begin
  if exists(select 1 from unnest(v_roles) role where role<>all(array['admin','assignor','official','mentor','registrar','viewer','billing'])) then raise exception 'Invalid role selected.'; end if;
  if cardinality(v_roles)=0 then raise exception 'Select at least one role.'; end if;
  if not private.valid_viewer_permissions(coalesce(p_viewer_permissions,'{}'::text[])) then raise exception 'Invalid viewer permission.'; end if;
  if not private.valid_organization_league_ids(p_organization_id,coalesce(p_league_ids,'{}'::uuid[])) then raise exception 'A selected league is not connected to this organization.'; end if;
  if v_roles&&array['assignor','mentor','registrar','viewer']::text[] and cardinality(coalesce(p_league_ids,'{}'::uuid[]))=0 then raise exception 'Select at least one league.'; end if;
  if 'viewer'=any(v_roles) and cardinality(coalesce(p_viewer_permissions,'{}'::text[]))=0 then raise exception 'Select at least one area this contact can view.'; end if;

  insert into public.organization_user_access_profiles(organization_id,user_id,roles,viewer_permissions,league_ids,updated_by)
  values(p_organization_id,p_user_id,v_roles,case when 'viewer'=any(v_roles) then p_viewer_permissions else '{}'::text[] end,p_league_ids,(select auth.uid()))
  on conflict(organization_id,user_id) do update set roles=excluded.roles,viewer_permissions=excluded.viewer_permissions,league_ids=excluded.league_ids,updated_at=now(),updated_by=excluded.updated_by;

  delete from public.organization_memberships where organization_id=p_organization_id and user_id=p_user_id and role<>'owner';
  insert into public.organization_memberships(organization_id,user_id,role,viewer_permissions)
  select p_organization_id,p_user_id,role,case when role='viewer' then
    case when 'viewer'=any(v_roles) then p_viewer_permissions else array['assignments']::text[] end else '{}'::text[] end
  from unnest(v_roles||case when 'mentor'=any(v_roles) and not('viewer'=any(v_roles)) then array['viewer']::text[] else '{}'::text[] end) role
  where role<>'official' on conflict(organization_id,user_id,role) do update set viewer_permissions=excluded.viewer_permissions;

  delete from public.organization_member_league_access where organization_id=p_organization_id and user_id=p_user_id;
  insert into public.organization_member_league_access(organization_id,user_id,league_id)
  select p_organization_id,p_user_id,league_id from unnest(coalesce(p_league_ids,'{}'::uuid[])) league_id on conflict do nothing;

  select lower(email) into v_email from auth.users where id=p_user_id;
  if 'official'=any(v_roles) then
    select id into v_official_id from public.officials where auth_user_id=p_user_id or lower(email)=v_email order by (auth_user_id=p_user_id) desc limit 1;
    if v_official_id is null then
      insert into public.officials(auth_user_id,full_name,first_name,last_name,email)
      values(p_user_id,split_part(v_email,'@',1),split_part(v_email,'@',1),'',v_email) returning id into v_official_id;
    else update public.officials set auth_user_id=p_user_id where id=v_official_id and auth_user_id is null; end if;
    insert into public.organization_officials(organization_id,official_id,active,added_by) values(p_organization_id,v_official_id,true,(select auth.uid()))
    on conflict(organization_id,official_id) do update set active=true;
    insert into public.user_roles(user_id,role) values(p_user_id,'official') on conflict do nothing;
  else
    update public.organization_officials oo set active=false from public.officials o where oo.organization_id=p_organization_id and oo.official_id=o.id and o.auth_user_id=p_user_id;
  end if;

  delete from public.league_staff_access where user_id=p_user_id and role='registrar' and league_id in(select league_id from public.organization_league_coverage where organization_id=p_organization_id);
  if 'registrar'=any(v_roles) then
    insert into public.league_staff_access(user_id,league_id,role) select p_user_id,league_id,'registrar' from unnest(p_league_ids) league_id on conflict do nothing;
    insert into public.user_roles(user_id,role) values(p_user_id,'registrar') on conflict do nothing;
  end if;
end $$;

create function public.set_organization_user_roles(p_organization_id uuid,p_user_id uuid,p_roles text[],p_viewer_permissions text[] default '{}'::text[],p_league_ids uuid[] default '{}'::uuid[])
returns void language plpgsql security invoker set search_path='' as $$ begin
 if not private.can_manage_organization(p_organization_id) then raise exception 'Only organization owners and administrators can change team access.'; end if;
 perform private.sync_organization_user_roles(p_organization_id,p_user_id,p_roles,p_viewer_permissions,p_league_ids);
end $$;

create function private.set_organization_invitation_roles_impl(p_invitation_id uuid,p_roles text[],p_viewer_permissions text[],p_league_ids uuid[])
returns void language plpgsql security definer set search_path='' as $$ declare v_org uuid;begin
 select organization_id into v_org from public.organization_invitations where id=p_invitation_id and status='pending';
 if v_org is null or not private.can_manage_organization(v_org) then raise exception 'Pending invitation was not found or access was denied.'; end if;
 if exists(select 1 from unnest(p_roles) role where role<>all(array['admin','assignor','official','mentor','registrar','viewer','billing'])) or cardinality(p_roles)=0 then raise exception 'Select valid roles.'; end if;
 if p_roles&&array['assignor','mentor','registrar','viewer']::text[] and cardinality(p_league_ids)=0 then raise exception 'Select at least one league.'; end if;
 update public.organization_invitations set roles=p_roles,viewer_permissions=case when 'viewer'=any(p_roles) then p_viewer_permissions else '{}'::text[] end,league_ids=p_league_ids where id=p_invitation_id;
end $$;

create function public.set_organization_invitation_roles(p_invitation_id uuid,p_roles text[],p_viewer_permissions text[] default '{}'::text[],p_league_ids uuid[] default '{}'::uuid[])
returns void language sql security invoker set search_path='' as $$
 select private.set_organization_invitation_roles_impl(p_invitation_id,p_roles,p_viewer_permissions,p_league_ids)
$$;

create or replace function private.accept_my_organization_invitations_impl() returns integer language plpgsql security definer set search_path='' as $$
declare v_email text;v_count integer:=0;invitation record;begin
 if (select auth.uid()) is null then raise exception 'Authentication required.'; end if;
 select lower(email) into v_email from auth.users where id=(select auth.uid());
 for invitation in update public.organization_invitations set status='accepted',accepted_at=now() where lower(email)=v_email and status='pending' returning organization_id,roles,role,viewer_permissions,league_ids loop
  perform private.sync_organization_user_roles(invitation.organization_id,(select auth.uid()),case when cardinality(invitation.roles)>0 then invitation.roles else array[invitation.role] end,invitation.viewer_permissions,invitation.league_ids);v_count:=v_count+1;
 end loop;return v_count;end $$;

create or replace function private.get_organization_team_impl(p_organization_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if (select auth.uid()) is null or not private.can_manage_organization(p_organization_id) then raise exception 'Only organization owners and administrators can view team access.'; end if;
 return jsonb_build_object('members',coalesce((select jsonb_agg(jsonb_build_object('id',u.id,'user_id',u.id,'email',lower(u.email),'roles',coalesce(a.roles,'{}'::text[]),'viewer_permissions',coalesce(a.viewer_permissions,'{}'::text[]),'league_ids',coalesce(a.league_ids,'{}'::uuid[]),'owner',exists(select 1 from public.organization_memberships m where m.organization_id=p_organization_id and m.user_id=u.id and m.role='owner'),'status','active') order by lower(u.email)) from auth.users u join(select distinct user_id from public.organization_memberships where organization_id=p_organization_id union select user_id from public.organization_user_access_profiles where organization_id=p_organization_id) people on people.user_id=u.id left join public.organization_user_access_profiles a on a.organization_id=p_organization_id and a.user_id=u.id),'[]'::jsonb),'invitations',coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'email',lower(i.email),'roles',case when cardinality(i.roles)>0 then i.roles else array[i.role] end,'viewer_permissions',i.viewer_permissions,'league_ids',i.league_ids,'status','pending') order by i.created_at desc) from public.organization_invitations i where i.organization_id=p_organization_id and i.status='pending'),'[]'::jsonb));
end $$;

create or replace function private.get_my_test_workspaces_impl() returns jsonb language sql stable security definer set search_path='' as $$
with access as(select o.id organization_id,coalesce(a.roles,'{}'::text[])||case when exists(select 1 from public.organization_memberships m where m.organization_id=o.id and m.user_id=(select auth.uid()) and m.role='owner') then array['owner']::text[] else '{}'::text[] end roles,coalesce(a.viewer_permissions,'{}'::text[]) viewer_permissions from public.organizations o left join public.organization_user_access_profiles a on a.organization_id=o.id and a.user_id=(select auth.uid()) where a.user_id is not null or exists(select 1 from public.organization_memberships m where m.organization_id=o.id and m.user_id=(select auth.uid())))
select coalesce(jsonb_agg(jsonb_build_object('organization_id',o.id,'name',o.name,'primary_sport',o.primary_sport,'created_at',o.created_at,'role',coalesce((access.roles)[1],'official'),'roles',access.roles,'viewer_permissions',access.viewer_permissions,'plan',s.plan,'official_limit',s.official_limit,'additional_official_blocks',s.additional_official_blocks,'status',s.status,'texting_addon',coalesce((select enabled from public.organization_addons where organization_id=o.id and code='text_messaging'),false),'leagues',coalesce((select jsonb_agg(jsonb_build_object('league_id',l.id,'name',l.name)) from public.organization_league_coverage c join public.leagues l on l.id=c.league_id where c.organization_id=o.id and c.active),'[]'::jsonb)) order by o.created_at desc),'[]'::jsonb) from access join public.organizations o on o.id=access.organization_id left join lateral(select * from public.refassign_subscriptions rs where rs.organization_id=o.id order by created_at desc limit 1)s on true;
$$;

revoke all on function private.sync_organization_user_roles(uuid,uuid,text[],text[],uuid[]) from public,anon,authenticated;
revoke all on function private.set_organization_invitation_roles_impl(uuid,text[],text[],uuid[]) from public,anon,authenticated;
revoke all on function public.set_organization_user_roles(uuid,uuid,text[],text[],uuid[]) from public,anon;
revoke all on function public.set_organization_invitation_roles(uuid,text[],text[],uuid[]) from public,anon;
grant execute on function private.sync_organization_user_roles(uuid,uuid,text[],text[],uuid[]) to authenticated;
grant execute on function private.set_organization_invitation_roles_impl(uuid,text[],text[],uuid[]) to authenticated;
grant execute on function public.set_organization_user_roles(uuid,uuid,text[],text[],uuid[]) to authenticated;
grant execute on function public.set_organization_invitation_roles(uuid,text[],text[],uuid[]) to authenticated;
notify pgrst,'reload schema';
