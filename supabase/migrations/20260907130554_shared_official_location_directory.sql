create unique index if not exists officials_email_unique_ci
  on public.officials (lower(email)) where email is not null;

create table if not exists public.organization_officials (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  official_id uuid not null references public.officials(id) on delete cascade,
  active boolean not null default true,
  added_by uuid references auth.users(id) on delete set null,
  joined_at timestamptz not null default now(),
  primary key (organization_id, official_id)
);

create table if not exists public.organization_official_invitations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  email text not null,
  invited_by uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','accepted','revoked')),
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  unique (organization_id, email)
);

alter table public.locations add column if not exists address text;
alter table public.locations add column if not exists postal_code text;
alter table public.locations add column if not exists latitude double precision;
alter table public.locations add column if not exists longitude double precision;

create table if not exists public.organization_locations (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  location_id uuid not null references public.locations(id) on delete cascade,
  display_name text,
  notes text,
  active boolean not null default true,
  added_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (organization_id, location_id)
);

create index if not exists organization_officials_official_idx on public.organization_officials(official_id);
create index if not exists organization_official_invitations_email_idx on public.organization_official_invitations(lower(email));
create index if not exists organization_locations_location_idx on public.organization_locations(location_id);
create index if not exists locations_search_idx on public.locations(lower(name), lower(city), lower(state));
-- Existing operational data can legitimately contain two venues at the same
-- normalized address (for example, separate fields in one complex). Keep this
-- as a lookup index; location reuse is resolved by the connection functions.
create index if not exists locations_address_lookup_ci on public.locations(
  lower(coalesce(address,'')), lower(coalesce(city,'')), lower(coalesce(state,'')), lower(coalesce(postal_code,''))
) where address is not null;

alter table public.organization_officials enable row level security;
alter table public.organization_official_invitations enable row level security;
alter table public.organization_locations enable row level security;

create policy "Members read organization officials" on public.organization_officials
for select to authenticated using (exists (
  select 1 from public.organization_memberships m
  where m.organization_id=organization_officials.organization_id and m.user_id=(select auth.uid())
));
create policy "Managers manage organization officials" on public.organization_officials
for all to authenticated using (private.can_manage_organization(organization_id))
with check (private.can_manage_organization(organization_id));

create policy "Managers read official invitations" on public.organization_official_invitations
for select to authenticated using (private.can_manage_organization(organization_id));
create policy "Managers manage official invitations" on public.organization_official_invitations
for all to authenticated using (private.can_manage_organization(organization_id))
with check (private.can_manage_organization(organization_id));

create policy "Members read organization locations" on public.organization_locations
for select to authenticated using (exists (
  select 1 from public.organization_memberships m
  where m.organization_id=organization_locations.organization_id and m.user_id=(select auth.uid())
));
create policy "Managers manage organization locations" on public.organization_locations
for all to authenticated using (private.can_manage_organization(organization_id))
with check (private.can_manage_organization(organization_id));

create or replace function private.add_organization_official_by_email_impl(p_organization_id uuid,p_email text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_email text:=lower(trim(p_email));v_official public.officials%rowtype;v_auth_user_id uuid;v_existing boolean:=false;
begin
  if (select auth.uid()) is null or not private.can_manage_organization(p_organization_id) then raise exception 'Not authorized.'; end if;
  if v_email !~* '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$' then raise exception 'Enter a valid email address.'; end if;
  select * into v_official from public.officials where lower(email)=v_email limit 1;
  v_existing:=v_official.id is not null;
  select id into v_auth_user_id from auth.users where lower(email)=v_email limit 1;
  if not v_existing then
    insert into public.officials(full_name,email,first_name,last_name,auth_user_id)
    values(v_email,v_email,'','',v_auth_user_id) returning * into v_official;
  elsif v_official.auth_user_id is null and v_auth_user_id is not null then
    update public.officials set auth_user_id=v_auth_user_id where id=v_official.id;
  end if;
  insert into public.organization_officials(organization_id,official_id,added_by)
  values(p_organization_id,v_official.id,(select auth.uid())) on conflict(organization_id,official_id) do update set active=true;
  if v_auth_user_id is null then
    insert into public.organization_official_invitations(organization_id,email,invited_by)
    values(p_organization_id,v_email,(select auth.uid()))
    on conflict(organization_id,email) do update set status='pending',invited_by=excluded.invited_by,created_at=now();
  end if;
  return jsonb_build_object('official_id',v_official.id,'email',v_email,'existing_official',v_existing,'existing_account',v_auth_user_id is not null,'invitation_needed',v_auth_user_id is null);
end $$;

create or replace function public.add_organization_official_by_email(p_organization_id uuid,p_email text)
returns jsonb language sql security invoker set search_path='' as $$
  select private.add_organization_official_by_email_impl(p_organization_id,p_email)
$$;

create or replace function private.search_location_directory_impl(p_organization_id uuid,p_query text)
returns table(id uuid,name text,address text,city text,state text,postal_code text,latitude double precision,longitude double precision,already_connected boolean)
language sql security definer set search_path='' as $$
  select l.id,l.name,l.address,l.city,l.state,l.postal_code,l.latitude,l.longitude,
    exists(select 1 from public.organization_locations ol where ol.organization_id=p_organization_id and ol.location_id=l.id)
  from public.locations l
  where private.can_manage_organization(p_organization_id)
    and length(trim(coalesce(p_query,'')))>=2
    and concat_ws(' ',l.name,l.address,l.city,l.state,l.postal_code) ilike '%'||trim(p_query)||'%'
  order by case when lower(l.name)=lower(trim(p_query)) then 0 else 1 end,l.name
  limit 25
$$;

create or replace function public.search_location_directory(p_organization_id uuid,p_query text)
returns table(id uuid,name text,address text,city text,state text,postal_code text,latitude double precision,longitude double precision,already_connected boolean)
language sql security invoker set search_path='' as $$
  select * from private.search_location_directory_impl(p_organization_id,p_query)
$$;

create or replace function private.connect_organization_location_impl(p_organization_id uuid,p_location_id uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
  if (select auth.uid()) is null or not private.can_manage_organization(p_organization_id) then raise exception 'Not authorized.'; end if;
  if not exists(select 1 from public.locations where id=p_location_id) then raise exception 'Location not found.'; end if;
  insert into public.organization_locations(organization_id,location_id,added_by)
  values(p_organization_id,p_location_id,(select auth.uid())) on conflict(organization_id,location_id) do update set active=true;
end $$;

create or replace function public.connect_organization_location(p_organization_id uuid,p_location_id uuid)
returns void language sql security invoker set search_path='' as $$
  select private.connect_organization_location_impl(p_organization_id,p_location_id)
$$;

revoke all on function private.add_organization_official_by_email_impl(uuid,text) from public,anon;
revoke all on function private.search_location_directory_impl(uuid,text) from public,anon;
revoke all on function private.connect_organization_location_impl(uuid,uuid) from public,anon;
grant execute on function private.add_organization_official_by_email_impl(uuid,text) to authenticated;
grant execute on function private.search_location_directory_impl(uuid,text) to authenticated;
grant execute on function private.connect_organization_location_impl(uuid,uuid) to authenticated;
revoke all on function public.add_organization_official_by_email(uuid,text) from public,anon;
revoke all on function public.search_location_directory(uuid,text) from public,anon;
revoke all on function public.connect_organization_location(uuid,uuid) from public,anon;
grant execute on function public.add_organization_official_by_email(uuid,text) to authenticated;
grant execute on function public.search_location_directory(uuid,text) to authenticated;
grant execute on function public.connect_organization_location(uuid,uuid) to authenticated;
grant select,insert,update,delete on public.organization_officials,public.organization_official_invitations,public.organization_locations to authenticated;
