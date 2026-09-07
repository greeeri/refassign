alter table public.officials
  add column if not exists home_address text,
  add column if not exists home_city text,
  add column if not exists home_state text,
  add column if not exists home_zip text;

alter table public.locations
  add column if not exists level_id uuid references public.levels(id) on delete set null,
  add column if not exists directions text,
  add column if not exists parking_instructions text,
  add column if not exists entrance_information text,
  add column if not exists map_url text,
  add column if not exists contact_name text,
  add column if not exists contact_phone text,
  add column if not exists contact_email text;

create or replace function private.get_organization_official_directory_impl(p_organization_id uuid)
returns table(
  id uuid, first_name text, last_name text, email text, phone text,
  home_area text, home_address text, home_city text, home_state text,
  home_zip text, sports text[], certification_level text, active boolean
)
language plpgsql security definer set search_path='' as $$
begin
  if (select auth.uid()) is null or not private.can_manage_organization(p_organization_id) then
    raise exception 'Not authorized.';
  end if;
  return query
  select o.id,o.first_name,o.last_name,o.email,o.phone,o.home_area,
    o.home_address,o.home_city,o.home_state,o.home_zip,o.sports,
    o.certification_level,oo.active
  from public.organization_officials oo
  join public.officials o on o.id=oo.official_id
  where oo.organization_id=p_organization_id and oo.active
  order by o.last_name nulls last,o.first_name nulls last,o.email;
end $$;

create or replace function public.get_organization_official_directory(p_organization_id uuid)
returns table(
  id uuid, first_name text, last_name text, email text, phone text,
  home_area text, home_address text, home_city text, home_state text,
  home_zip text, sports text[], certification_level text, active boolean
)
language sql security invoker set search_path='' as $$
  select * from private.get_organization_official_directory_impl(p_organization_id)
$$;

create or replace function private.get_organization_locations_impl(p_organization_id uuid)
returns table(
  id uuid,name text,address text,city text,state text,directions text,
  parking_instructions text,entrance_information text,map_url text,
  contact_name text,contact_phone text,contact_email text
)
language plpgsql security definer set search_path='' as $$
begin
  if (select auth.uid()) is null or not private.can_manage_organization(p_organization_id) then
    raise exception 'Not authorized.';
  end if;
  return query
  select l.id,coalesce(nullif(ol.display_name,''),l.name),l.address,l.city,l.state,
    l.directions,l.parking_instructions,l.entrance_information,l.map_url,
    l.contact_name,l.contact_phone,l.contact_email
  from public.organization_locations ol
  join public.locations l on l.id=ol.location_id
  where ol.organization_id=p_organization_id and ol.active and l.active
  order by coalesce(nullif(ol.display_name,''),l.name);
end $$;

create or replace function public.get_organization_locations(p_organization_id uuid)
returns table(
  id uuid,name text,address text,city text,state text,directions text,
  parking_instructions text,entrance_information text,map_url text,
  contact_name text,contact_phone text,contact_email text
)
language sql security invoker set search_path='' as $$
  select * from private.get_organization_locations_impl(p_organization_id)
$$;

create or replace function private.save_organization_location_impl(
  p_organization_id uuid,p_location_id uuid,p_name text,p_address text,
  p_city text,p_state text,p_directions text,p_parking_instructions text,
  p_entrance_information text,p_map_url text,p_contact_name text,
  p_contact_phone text,p_contact_email text,p_latitude double precision,
  p_longitude double precision
) returns uuid language plpgsql security definer set search_path='' as $$
declare v_location_id uuid:=p_location_id;
begin
  if (select auth.uid()) is null or not private.can_manage_organization(p_organization_id) then
    raise exception 'Not authorized.';
  end if;
  if length(trim(coalesce(p_name,'')))<2 then raise exception 'Location name is required.'; end if;
  if v_location_id is null then
    select l.id into v_location_id from public.locations l
    where lower(l.name)=lower(trim(p_name))
      and lower(coalesce(l.city,''))=lower(trim(coalesce(p_city,'')))
      and lower(coalesce(l.state,''))=lower(trim(coalesce(p_state,'')))
    limit 1;
  end if;
  if v_location_id is null then
    insert into public.locations(name,address,city,state,directions,parking_instructions,
      entrance_information,map_url,contact_name,contact_phone,contact_email,latitude,longitude,active)
    values(trim(p_name),nullif(trim(coalesce(p_address,'')),''),nullif(trim(coalesce(p_city,'')),''),
      nullif(trim(coalesce(p_state,'')),''),nullif(trim(coalesce(p_directions,'')),''),
      nullif(trim(coalesce(p_parking_instructions,'')),''),nullif(trim(coalesce(p_entrance_information,'')),''),
      nullif(trim(coalesce(p_map_url,'')),''),nullif(trim(coalesce(p_contact_name,'')),''),
      nullif(trim(coalesce(p_contact_phone,'')),''),nullif(trim(coalesce(p_contact_email,'')),''),
      p_latitude,p_longitude,true) returning id into v_location_id;
  else
    if not exists(select 1 from public.organization_locations where organization_id=p_organization_id and location_id=v_location_id)
       and p_location_id is not null then raise exception 'Location is not connected to this organization.'; end if;
    update public.locations set name=trim(p_name),address=nullif(trim(coalesce(p_address,'')),''),
      city=nullif(trim(coalesce(p_city,'')),''),state=nullif(trim(coalesce(p_state,'')),''),
      directions=nullif(trim(coalesce(p_directions,'')),''),parking_instructions=nullif(trim(coalesce(p_parking_instructions,'')),''),
      entrance_information=nullif(trim(coalesce(p_entrance_information,'')),''),map_url=nullif(trim(coalesce(p_map_url,'')),''),
      contact_name=nullif(trim(coalesce(p_contact_name,'')),''),contact_phone=nullif(trim(coalesce(p_contact_phone,'')),''),
      contact_email=nullif(trim(coalesce(p_contact_email,'')),''),latitude=coalesce(p_latitude,latitude),
      longitude=coalesce(p_longitude,longitude),active=true where id=v_location_id;
  end if;
  insert into public.organization_locations(organization_id,location_id,added_by)
  values(p_organization_id,v_location_id,(select auth.uid()))
  on conflict(organization_id,location_id) do update set active=true;
  return v_location_id;
end $$;

create or replace function public.save_organization_location(
  p_organization_id uuid,p_location_id uuid,p_name text,p_address text,
  p_city text,p_state text,p_directions text,p_parking_instructions text,
  p_entrance_information text,p_map_url text,p_contact_name text,
  p_contact_phone text,p_contact_email text,p_latitude double precision,
  p_longitude double precision
) returns uuid language sql security invoker set search_path='' as $$
  select private.save_organization_location_impl(p_organization_id,p_location_id,p_name,p_address,p_city,p_state,p_directions,p_parking_instructions,p_entrance_information,p_map_url,p_contact_name,p_contact_phone,p_contact_email,p_latitude,p_longitude)
$$;

revoke all on function private.get_organization_official_directory_impl(uuid) from public,anon;
revoke all on function public.get_organization_official_directory(uuid) from public,anon;
revoke all on function private.get_organization_locations_impl(uuid) from public,anon;
revoke all on function public.get_organization_locations(uuid) from public,anon;
revoke all on function private.save_organization_location_impl(uuid,uuid,text,text,text,text,text,text,text,text,text,text,text,double precision,double precision) from public,anon;
revoke all on function public.save_organization_location(uuid,uuid,text,text,text,text,text,text,text,text,text,text,text,double precision,double precision) from public,anon;
grant execute on function private.get_organization_official_directory_impl(uuid) to authenticated;
grant execute on function public.get_organization_official_directory(uuid) to authenticated;
grant execute on function private.get_organization_locations_impl(uuid) to authenticated;
grant execute on function public.get_organization_locations(uuid) to authenticated;
grant execute on function private.save_organization_location_impl(uuid,uuid,text,text,text,text,text,text,text,text,text,text,text,double precision,double precision) to authenticated;
grant execute on function public.save_organization_location(uuid,uuid,text,text,text,text,text,text,text,text,text,text,text,double precision,double precision) to authenticated;
