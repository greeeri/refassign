-- League-scoped registration and a single protected RefAssign owner account.
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check
check (role in ('admin','assignor','scheduler','official','school','registrar','league_admin','super_admin'));

alter table public.user_roles drop constraint if exists user_roles_role_check;
alter table public.user_roles add constraint user_roles_role_check
check (role in ('admin','assignor','official','contact','registrar','league_admin','super_admin'));

create table if not exists public.protected_accounts (
  user_id uuid primary key references auth.users(id) on delete restrict,
  created_at timestamptz not null default now()
);
alter table public.protected_accounts enable row level security;
revoke all on public.protected_accounts from anon, authenticated;

insert into public.protected_accounts(user_id)
values ('8a306e8d-70b6-4813-8e9d-d46e8ee77de9')
on conflict do nothing;
insert into public.user_roles(user_id,role)
values ('8a306e8d-70b6-4813-8e9d-d46e8ee77de9','super_admin')
on conflict do nothing;

create or replace function public.is_super_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.protected_accounts
    where user_id = (select auth.uid())
  );
$$;
revoke all on function public.is_super_admin() from public, anon;
grant execute on function public.is_super_admin() to authenticated;

-- Keep the private super_admin role out of the normal role switcher.
create or replace function public.current_user_roles()
returns text[] language sql stable security invoker set search_path = '' as $$
  select coalesce(
    array_agg(role order by case role
      when 'admin' then 1 when 'assignor' then 2 when 'league_admin' then 3
      when 'registrar' then 4 when 'official' then 5 else 6 end), array[]::text[]
  )
  from public.user_roles
  where user_id = (select auth.uid()) and role <> 'super_admin';
$$;

create table if not exists public.league_staff_access (
  user_id uuid not null references auth.users(id) on delete cascade,
  league_id uuid not null references public.leagues(id) on delete cascade,
  role text not null check (role in ('admin','registrar')),
  created_at timestamptz not null default now(),
  primary key(user_id,league_id,role)
);
alter table public.league_staff_access enable row level security;
grant select on public.league_staff_access to authenticated;
create policy "Staff read own league access" on public.league_staff_access
for select to authenticated using (
  user_id=(select auth.uid()) or (select public.is_super_admin())
);

create policy "League registration staff read assigned leagues" on public.leagues
for select to authenticated using (
  public.is_super_admin() or exists (
    select 1 from public.league_staff_access access
    where access.user_id=(select auth.uid()) and access.league_id=leagues.id
  )
);
create policy "Registrars read active levels" on public.levels
for select to authenticated using (
  public.is_super_admin() or exists (
    select 1 from public.user_roles role
    where role.user_id=(select auth.uid()) and role.role in ('registrar','league_admin')
  )
);

create or replace function public.can_manage_registration_league(p_league_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.is_super_admin() or exists (
    select 1 from public.league_staff_access access
    join public.profiles profile on profile.id=access.user_id
    where access.user_id=(select auth.uid())
      and access.league_id=p_league_id
      and access.role in ('admin','registrar')
      and profile.active=true
  );
$$;
revoke all on function public.can_manage_registration_league(uuid) from public, anon;
grant execute on function public.can_manage_registration_league(uuid) to authenticated;

create table if not exists public.league_registration_settings (
  league_id uuid primary key references public.leagues(id) on delete cascade,
  registration_fee_cents integer not null check (registration_fee_cents > 0),
  registration_open boolean not null default true,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);
alter table public.league_registration_settings enable row level security;
grant select,insert,update,delete on public.league_registration_settings to authenticated;
create policy "League staff read registration settings"
on public.league_registration_settings for select to authenticated
using (public.can_manage_registration_league(league_id));
create policy "League staff insert registration settings"
on public.league_registration_settings for insert to authenticated
with check (public.can_manage_registration_league(league_id));
create policy "League staff update registration settings"
on public.league_registration_settings for update to authenticated
using (public.can_manage_registration_league(league_id))
with check (public.can_manage_registration_league(league_id));
create policy "League staff delete registration settings"
on public.league_registration_settings for delete to authenticated
using (public.can_manage_registration_league(league_id));

alter table public.official_registrations
add column if not exists league_id uuid references public.leagues(id) on delete restrict;
drop index if exists public.official_registrations_email_year_idx;
create unique index if not exists official_registrations_email_year_league_idx
on public.official_registrations(lower(email),registration_year,league_id)
where league_id is not null;

drop policy if exists "Registrars manage registrations" on public.official_registrations;
create policy "League staff manage registrations"
on public.official_registrations for all to authenticated
using (league_id is not null and public.can_manage_registration_league(league_id))
with check (league_id is not null and public.can_manage_registration_league(league_id));

drop policy if exists "Registrars manage registration settings" on public.registration_settings;
revoke all on public.registration_settings from authenticated;

create or replace function public.list_open_registration_leagues()
returns table(id uuid,name text,fee_cents integer)
language sql stable security definer set search_path='' as $$
  select league.id,league.name,settings.registration_fee_cents
  from public.leagues league
  join public.league_registration_settings settings on settings.league_id=league.id
  where league.active=true and settings.registration_open=true
  order by league.name;
$$;
revoke all on function public.list_open_registration_leagues() from public;
grant execute on function public.list_open_registration_leagues() to anon,authenticated;

drop function if exists public.submit_official_registration(text,text,text,text,text,text,text,text,text);
create function public.submit_official_registration(
  p_first_name text,p_last_name text,p_email text,p_phone text,
  p_home_address text,p_home_city text,p_home_state text,p_home_zip text,
  p_sport text,p_league_id uuid
)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_token uuid; v_fee integer;
begin
  if length(trim(coalesce(p_first_name,''))) not between 1 and 80
    or length(trim(coalesce(p_last_name,''))) not between 1 and 80 then
    raise exception 'First and last name are required.';
  end if;
  if trim(coalesce(p_email,'')) !~* '^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$' then
    raise exception 'Enter a valid email address.';
  end if;
  select registration_fee_cents into v_fee
  from public.league_registration_settings
  where league_id=p_league_id and registration_open=true;
  if v_fee is null then raise exception 'Registration is not open for that league.'; end if;
  if exists(select 1 from public.official_registrations
    where lower(email)=lower(trim(p_email))
      and registration_year=extract(year from current_date)::integer
      and league_id=p_league_id) then
    raise exception 'A registration already exists for this email and league this year.';
  end if;
  insert into public.official_registrations(
    first_name,last_name,email,phone,home_address,home_city,home_state,home_zip,
    sport,fee_cents,league_id,status,payment_status
  ) values (
    trim(p_first_name),trim(p_last_name),lower(trim(p_email)),nullif(trim(coalesce(p_phone,'')),''),
    nullif(trim(coalesce(p_home_address,'')),''),nullif(trim(coalesce(p_home_city,'')),''),
    nullif(trim(coalesce(p_home_state,'')),''),nullif(trim(coalesce(p_home_zip,'')),''),
    coalesce(nullif(trim(coalesce(p_sport,'')),''),'Soccer'),v_fee,p_league_id,
    'payment_pending','pending'
  ) returning public_token into v_token;
  return v_token;
end;
$$;
revoke all on function public.submit_official_registration(text,text,text,text,text,text,text,text,text,uuid) from public;
grant execute on function public.submit_official_registration(text,text,text,text,text,text,text,text,text,uuid) to anon,authenticated;

drop function if exists public.get_registration_status(uuid);
create function public.get_registration_status(p_token uuid)
returns table(first_name text,last_name text,email text,status text,payment_status text,
  fee_cents integer,registration_year integer,league_name text)
language sql stable security definer set search_path='' as $$
  select registration.first_name,registration.last_name,registration.email,
    registration.status,registration.payment_status,registration.fee_cents,
    registration.registration_year,league.name
  from public.official_registrations registration
  join public.leagues league on league.id=registration.league_id
  where registration.public_token=p_token;
$$;
revoke all on function public.get_registration_status(uuid) from public;
grant execute on function public.get_registration_status(uuid) to anon,authenticated;

create or replace function public.mark_registration_paid(p_registration_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare v_registration public.official_registrations;
begin
  select * into v_registration from public.official_registrations
  where id=p_registration_id for update;
  if v_registration.id is null then raise exception 'Registration not found'; end if;
  if not public.can_manage_registration_league(v_registration.league_id) then raise exception 'Not authorized'; end if;
  update public.official_registrations set payment_status='paid',status='paid',
    paid_at=coalesce(paid_at,now()),updated_at=now()
  where id=p_registration_id;
end;
$$;
revoke all on function public.mark_registration_paid(uuid) from public,anon;
grant execute on function public.mark_registration_paid(uuid) to authenticated;

drop function if exists public.approve_official_registration(uuid,uuid[]);
create function public.approve_official_registration(p_registration_id uuid,p_level_ids uuid[])
returns uuid language plpgsql security definer set search_path='' as $$
declare v_registration public.official_registrations; v_official_id uuid;
begin
  select * into v_registration from public.official_registrations where id=p_registration_id for update;
  if v_registration.id is null then raise exception 'Registration not found'; end if;
  if not public.can_manage_registration_league(v_registration.league_id) then raise exception 'Not authorized'; end if;
  if v_registration.payment_status <> 'paid' then raise exception 'Registration must be marked paid before approval'; end if;
  select id into v_official_id from public.officials where lower(email)=lower(v_registration.email) limit 1;
  if v_official_id is null then
    insert into public.officials(first_name,last_name,full_name,email,phone,home_address,
      home_city,home_state,home_zip,sports,active)
    values(v_registration.first_name,v_registration.last_name,
      v_registration.first_name||' '||v_registration.last_name,v_registration.email,
      v_registration.phone,v_registration.home_address,v_registration.home_city,
      v_registration.home_state,v_registration.home_zip,array[v_registration.sport],true)
    returning id into v_official_id;
  else
    update public.officials set first_name=v_registration.first_name,last_name=v_registration.last_name,
      full_name=v_registration.first_name||' '||v_registration.last_name,
      phone=coalesce(v_registration.phone,phone),home_address=coalesce(v_registration.home_address,home_address),
      home_city=coalesce(v_registration.home_city,home_city),home_state=coalesce(v_registration.home_state,home_state),
      home_zip=coalesce(v_registration.home_zip,home_zip),active=true where id=v_official_id;
  end if;
  insert into public.official_league_eligibility(official_id,league_id)
  values(v_official_id,v_registration.league_id) on conflict do nothing;
  insert into public.official_level_eligibility(official_id,level_id)
  select v_official_id,requested.level_id from unnest(coalesce(p_level_ids,array[]::uuid[])) requested(level_id)
  join public.levels level on level.id=requested.level_id and level.active=true on conflict do nothing;
  update public.official_registrations set official_id=v_official_id,status='approved',
    reviewed_at=now(),reviewed_by=auth.uid(),updated_at=now() where id=p_registration_id;
  return v_official_id;
end;
$$;
revoke all on function public.approve_official_registration(uuid,uuid[]) from public,anon;
grant execute on function public.approve_official_registration(uuid,uuid[]) to authenticated;

create table if not exists public.super_admin_audit (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  action text not null,
  target_user_id uuid references auth.users(id) on delete set null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
alter table public.super_admin_audit enable row level security;
revoke all on public.super_admin_audit from anon,authenticated;

-- Ensure future sign-ins preserve the protected owner role.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  insert into public.profiles(id,full_name,role,active)
  values(new.id,coalesce(new.raw_user_meta_data->>'full_name',split_part(new.email,'@',1)),
    case when lower(new.email)='greeeri@gmail.com' then 'super_admin' else 'official' end,true)
  on conflict(id) do update set role=case when lower(new.email)='greeeri@gmail.com'
    then 'super_admin' else public.profiles.role end;
  if lower(new.email)='greeeri@gmail.com' then
    insert into public.protected_accounts(user_id) values(new.id) on conflict do nothing;
    insert into public.user_roles(user_id,role) values(new.id,'super_admin') on conflict do nothing;
  end if;
  return new;
end;
$$;
update public.profiles set role='super_admin',active=true
where id='8a306e8d-70b6-4813-8e9d-d46e8ee77de9';
