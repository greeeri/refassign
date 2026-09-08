create or replace function private.search_location_directory_impl(p_organization_id uuid,p_query text)
returns table(id uuid,name text,address text,city text,state text,postal_code text,latitude double precision,longitude double precision,already_connected boolean)
language sql security definer set search_path='' as $$
  select l.id,l.name,l.address,l.city,l.state,l.postal_code,l.latitude,l.longitude,
    exists(select 1 from public.organization_locations ol where ol.organization_id=p_organization_id and ol.location_id=l.id)
  from public.locations l
  where private.can_manage_organization(p_organization_id)
    and length(trim(coalesce(p_query,'')))>=2
    and not exists (
      select 1
      from regexp_split_to_table(trim(p_query), E'\\s+') search_term
      where concat_ws(' ',l.name,l.address,l.city,l.state,l.postal_code) not ilike '%'||search_term||'%'
    )
  order by
    case when lower(l.city)=lower(trim(p_query)) then 0
         when lower(l.name)=lower(trim(p_query)) then 1
         when lower(l.city) like lower(trim(p_query))||'%' then 2
         when lower(l.name) like lower(trim(p_query))||'%' then 3
         else 4 end,
    l.city nulls last,l.name
  limit 50
$$;
