alter table public.organization_memberships
  drop constraint if exists organization_memberships_role_check;
alter table public.organization_memberships
  add constraint organization_memberships_role_check
  check (role in ('owner','admin','assignor','billing','viewer','mentor','registrar','iowa_development_admin'));

alter table public.organization_user_access_profiles
  drop constraint if exists organization_user_access_profiles_roles_check;
alter table public.organization_user_access_profiles
  add constraint organization_user_access_profiles_roles_check
  check (roles <@ array['admin','assignor','official','mentor','registrar','viewer','billing','iowa_development_admin']::text[]);

alter table public.registration_programs
  add column if not exists organization_id uuid references public.organizations(id) on delete set null;
update public.registration_programs program
set organization_id=organization.id
from lateral (
  select id from public.organizations
  where lower(trim(name))='iowa soccer'
  order by created_at
  limit 1
) organization
where program.slug='iowa-soccer' and program.organization_id is null;

create or replace function private.can_access_organization_league(
  p_organization_id uuid,
  p_league_id uuid,
  p_user_id uuid
) returns boolean
language sql stable security definer set search_path='' as $$
  select p_user_id is not null
    and exists (
      select 1 from public.organization_league_coverage coverage
      where coverage.organization_id=p_organization_id
        and coverage.league_id=p_league_id
        and coverage.active
    )
    and (
      private.is_organization_owner_or_admin(p_organization_id,p_user_id)
      or exists (
        select 1 from public.organization_memberships membership
        where membership.organization_id=p_organization_id
          and membership.user_id=p_user_id
          and membership.role='iowa_development_admin'
      )
      or exists (
        select 1
        from public.organization_memberships membership
        join public.organization_member_league_access access
          on access.organization_id=membership.organization_id
         and access.user_id=membership.user_id
         and access.league_id=p_league_id
        where membership.organization_id=p_organization_id
          and membership.user_id=p_user_id
          and membership.role in ('assignor','viewer','billing')
      )
    )
$$;

create or replace function private.sync_organization_user_roles(
  p_organization_id uuid,p_user_id uuid,p_roles text[],p_viewer_permissions text[],p_league_ids uuid[]
) returns void language plpgsql security definer set search_path='' as $$
declare v_roles text[]:=coalesce(p_roles,'{}'::text[]);v_email text;v_official_id uuid;
begin
  if exists(select 1 from unnest(v_roles) role where role<>all(array['admin','assignor','official','mentor','registrar','viewer','billing','iowa_development_admin'])) then raise exception 'Invalid role selected.'; end if;
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

create or replace function private.set_organization_invitation_roles_impl(p_invitation_id uuid,p_roles text[],p_viewer_permissions text[],p_league_ids uuid[])
returns void language plpgsql security definer set search_path='' as $$ declare v_org uuid;begin
 select organization_id into v_org from public.organization_invitations where id=p_invitation_id and status='pending';
 if v_org is null or not private.can_manage_organization(v_org) then raise exception 'Pending invitation was not found or access was denied.'; end if;
 if exists(select 1 from unnest(p_roles) role where role<>all(array['admin','assignor','official','mentor','registrar','viewer','billing','iowa_development_admin'])) or cardinality(p_roles)=0 then raise exception 'Select valid roles.'; end if;
 if p_roles&&array['assignor','mentor','registrar','viewer']::text[] and cardinality(p_league_ids)=0 then raise exception 'Select at least one league.'; end if;
 update public.organization_invitations set roles=p_roles,viewer_permissions=case when 'viewer'=any(p_roles) then p_viewer_permissions else '{}'::text[] end,league_ids=p_league_ids where id=p_invitation_id;
end $$;

create or replace function public.is_iowa_soccer_development_staff()
returns boolean language sql stable security definer set search_path='' as $$
  select exists(
    select 1 from public.registration_program_staff staff
    join public.registration_programs program on program.id=staff.program_id
    join public.profiles profile on profile.id=staff.user_id
    where staff.user_id=(select auth.uid()) and staff.role in ('admin','registrar')
      and program.slug='iowa-soccer' and program.active=true and profile.active=true
  ) or exists(
    select 1 from public.organization_user_access_profiles access
    join public.registration_programs program
      on program.organization_id=access.organization_id
    join public.profiles profile on profile.id=access.user_id
    where access.user_id=(select auth.uid())
      and 'iowa_development_admin'=any(access.roles)
      and program.slug='iowa-soccer' and program.active=true
      and profile.active=true
  );
$$;

revoke all on function public.is_iowa_soccer_development_staff() from public,anon;
grant execute on function public.is_iowa_soccer_development_staff() to authenticated;
notify pgrst,'reload schema';
