-- Official invitations predate multi-role workspace access profiles. Keep the
-- canonical official link and the workspace role in sync when an invitation is
-- accepted, and repair officials who accepted before this migration.

create or replace function private.accept_my_official_invitations_impl()
returns integer language plpgsql security definer set search_path='' as $$
declare
  v_user_id uuid := (select auth.uid());
  v_email text;
  v_first_name text;
  v_last_name text;
  v_full_name text;
  v_count integer := 0;
begin
  if v_user_id is null then raise exception 'Authentication required.'; end if;

  select lower(email),
    nullif(trim(raw_user_meta_data->>'first_name'),''),
    nullif(trim(raw_user_meta_data->>'last_name'),''),
    nullif(trim(coalesce(raw_user_meta_data->>'full_name',raw_user_meta_data->>'name','')),'')
  into v_email,v_first_name,v_last_name,v_full_name
  from auth.users where id=v_user_id;

  if v_first_name is null and v_full_name is not null then
    v_first_name := split_part(v_full_name,' ',1);
  end if;
  if v_last_name is null and v_full_name is not null and position(' ' in v_full_name)>0 then
    v_last_name := trim(substr(v_full_name,position(' ' in v_full_name)+1));
  end if;

  update public.officials
  set auth_user_id=v_user_id,
      first_name=coalesce(nullif(trim(first_name),''),v_first_name,''),
      last_name=coalesce(nullif(trim(last_name),''),v_last_name,''),
      full_name=coalesce(nullif(trim(full_name),''),v_full_name,v_email)
  where lower(email)=v_email and (auth_user_id is null or auth_user_id=v_user_id);

  insert into public.organization_officials(organization_id,official_id,active,added_by)
  select i.organization_id,o.id,true,v_user_id
  from public.organization_official_invitations i
  join public.officials o on o.auth_user_id=v_user_id
  where lower(i.email)=v_email and i.status='pending'
  on conflict(organization_id,official_id) do update set active=true;

  insert into public.organization_user_access_profiles(
    organization_id,user_id,roles,viewer_permissions,league_ids
  )
  select oo.organization_id,v_user_id,array['official']::text[],'{}'::text[],'{}'::uuid[]
  from public.officials o
  join public.organization_officials oo on oo.official_id=o.id and oo.active
  where o.auth_user_id=v_user_id
  on conflict(organization_id,user_id) do update
  set roles=(select array_agg(distinct role_name order by role_name)
             from unnest(coalesce(organization_user_access_profiles.roles,'{}'::text[])||array['official']::text[]) role_name),
      updated_at=now();

  insert into public.user_roles(user_id,role)
  values(v_user_id,'official') on conflict do nothing;

  update public.organization_official_invitations
  set status='accepted',accepted_at=coalesce(accepted_at,now())
  where lower(email)=v_email and status='pending';
  get diagnostics v_count=row_count;
  return v_count;
end $$;

insert into public.organization_user_access_profiles(
  organization_id,user_id,roles,viewer_permissions,league_ids
)
select distinct oo.organization_id,o.auth_user_id,array['official']::text[],'{}'::text[],'{}'::uuid[]
from public.officials o
join public.organization_officials oo on oo.official_id=o.id and oo.active
where o.auth_user_id is not null
on conflict(organization_id,user_id) do update
set roles=(select array_agg(distinct role_name order by role_name)
           from unnest(coalesce(organization_user_access_profiles.roles,'{}'::text[])||array['official']::text[]) role_name),
    updated_at=now();

insert into public.user_roles(user_id,role)
select distinct auth_user_id,'official' from public.officials where auth_user_id is not null
on conflict do nothing;

notify pgrst,'reload schema';
