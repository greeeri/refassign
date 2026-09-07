create or replace function private.search_organization_official_email_impl(p_organization_id uuid,p_email text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_email text := lower(trim(p_email));
  v_official public.officials%rowtype;
  v_auth_user_id uuid;
  v_auth_name text;
begin
  if (select auth.uid()) is null or not private.can_manage_organization(p_organization_id) then
    raise exception 'Not authorized.';
  end if;
  if v_email !~* '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$' then
    raise exception 'Enter a valid email address.';
  end if;
  select * into v_official from public.officials where lower(email)=v_email limit 1;
  select id,coalesce(raw_user_meta_data->>'full_name',raw_user_meta_data->>'name','')
    into v_auth_user_id,v_auth_name from auth.users where lower(email)=v_email limit 1;
  return jsonb_build_object(
    'email',v_email,
    'found',v_official.id is not null or v_auth_user_id is not null,
    'official_id',v_official.id,
    'display_name',coalesce(nullif(trim(concat_ws(' ',v_official.first_name,v_official.last_name)),''),nullif(v_official.full_name,''),nullif(v_auth_name,''),v_email),
    'existing_official',v_official.id is not null,
    'existing_account',v_auth_user_id is not null,
    'already_connected',v_official.id is not null and exists(
      select 1 from public.organization_officials oo
      where oo.organization_id=p_organization_id and oo.official_id=v_official.id and oo.active
    )
  );
end $$;

create or replace function public.search_organization_official_email(p_organization_id uuid,p_email text)
returns jsonb language sql security invoker set search_path='' as $$
  select private.search_organization_official_email_impl(p_organization_id,p_email)
$$;

create or replace function private.create_and_connect_organization_location_impl(
  p_organization_id uuid,p_name text,p_address text,p_city text,p_state text,p_postal_code text,
  p_latitude double precision,p_longitude double precision
) returns uuid language plpgsql security definer set search_path='' as $$
declare v_location_id uuid;
begin
  if (select auth.uid()) is null or not private.can_manage_organization(p_organization_id) then
    raise exception 'Not authorized.';
  end if;
  if length(trim(coalesce(p_name,'')))<2 then raise exception 'Location name is required.'; end if;
  select id into v_location_id from public.locations
  where (p_latitude is not null and p_longitude is not null and abs(latitude-p_latitude)<0.00001 and abs(longitude-p_longitude)<0.00001)
     or (lower(name)=lower(trim(p_name)) and lower(coalesce(city,''))=lower(trim(coalesce(p_city,''))) and lower(coalesce(state,''))=lower(trim(coalesce(p_state,''))))
  limit 1;
  if v_location_id is null then
    insert into public.locations(name,address,city,state,postal_code,latitude,longitude,active)
    values(trim(p_name),nullif(trim(coalesce(p_address,'')),''),nullif(trim(coalesce(p_city,'')),''),nullif(trim(coalesce(p_state,'')),''),nullif(trim(coalesce(p_postal_code,'')),''),p_latitude,p_longitude,true)
    returning id into v_location_id;
  end if;
  insert into public.organization_locations(organization_id,location_id,added_by)
  values(p_organization_id,v_location_id,(select auth.uid()))
  on conflict(organization_id,location_id) do update set active=true;
  return v_location_id;
end $$;

create or replace function public.create_and_connect_organization_location(
  p_organization_id uuid,p_name text,p_address text,p_city text,p_state text,p_postal_code text,
  p_latitude double precision,p_longitude double precision
) returns uuid language sql security invoker set search_path='' as $$
  select private.create_and_connect_organization_location_impl(p_organization_id,p_name,p_address,p_city,p_state,p_postal_code,p_latitude,p_longitude)
$$;

revoke all on function private.search_organization_official_email_impl(uuid,text) from public,anon;
revoke all on function public.search_organization_official_email(uuid,text) from public,anon;
revoke all on function private.create_and_connect_organization_location_impl(uuid,text,text,text,text,text,double precision,double precision) from public,anon;
revoke all on function public.create_and_connect_organization_location(uuid,text,text,text,text,text,double precision,double precision) from public,anon;
grant execute on function private.search_organization_official_email_impl(uuid,text) to authenticated;
grant execute on function public.search_organization_official_email(uuid,text) to authenticated;
grant execute on function private.create_and_connect_organization_location_impl(uuid,text,text,text,text,text,double precision,double precision) to authenticated;
grant execute on function public.create_and_connect_organization_location(uuid,text,text,text,text,text,double precision,double precision) to authenticated;
