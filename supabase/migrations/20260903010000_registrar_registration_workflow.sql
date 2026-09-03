alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check
check (role in ('admin','assignor','scheduler','official','school','registrar'));

alter table public.user_roles drop constraint if exists user_roles_role_check;
alter table public.user_roles add constraint user_roles_role_check
check (role in ('admin','assignor','official','contact','registrar'));

insert into public.user_roles(user_id, role)
select user_id, 'registrar' from public.user_roles where role = 'admin'
on conflict (user_id, role) do nothing;

create or replace function public.current_user_roles()
returns text[] language sql stable security invoker set search_path = '' as $$
  select coalesce(
    array_agg(role order by case role
      when 'admin' then 1 when 'assignor' then 2 when 'registrar' then 3
      when 'official' then 4 else 5 end), array[]::text[]
  )
  from public.user_roles where user_id = (select auth.uid());
$$;

create or replace function public.can_manage_registrations()
returns boolean language sql stable security invoker set search_path = '' as $$
  select exists (
    select 1 from public.user_roles role
    join public.profiles profile on profile.id = role.user_id
    where role.user_id = (select auth.uid())
      and role.role in ('admin','registrar') and profile.active = true
  );
$$;

create table if not exists public.registration_settings (
  id boolean primary key default true check (id),
  registration_fee_cents integer check (registration_fee_cents is null or registration_fee_cents > 0),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);
insert into public.registration_settings(id) values(true) on conflict (id) do nothing;

create table if not exists public.official_registrations (
  id uuid primary key default gen_random_uuid(),
  public_token uuid not null unique default gen_random_uuid(),
  official_id uuid references public.officials(id) on delete set null,
  registration_year integer not null default extract(year from current_date)::integer,
  first_name text not null,
  last_name text not null,
  email text not null,
  phone text,
  home_address text,
  home_city text,
  home_state text,
  home_zip text,
  sport text not null default 'Soccer',
  status text not null default 'payment_pending'
    check (status in ('payment_pending','paid','approved','rejected')),
  payment_status text not null default 'pending'
    check (payment_status in ('pending','paid','waived','refunded')),
  fee_cents integer check (fee_cents is null or fee_cents >= 0),
  stripe_checkout_session_id text unique,
  stripe_payment_intent_id text,
  paid_at timestamptz,
  registrar_notified_at timestamptz,
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists official_registrations_email_year_idx
on public.official_registrations(lower(email), registration_year);
create index if not exists official_registrations_status_created_idx
on public.official_registrations(status, created_at desc);

insert into public.official_registrations(
  official_id, first_name, last_name, email, phone, home_address, home_city,
  home_state, home_zip, sport, status, payment_status, fee_cents,
  paid_at, reviewed_at
)
select official.id, official.first_name, official.last_name,
  coalesce(nullif(official.email,''), official.id::text || '@existing.refassign'),
  official.phone, official.home_address, official.home_city,
  official.home_state, official.home_zip,
  coalesce(official.sports[1], 'Soccer'), 'approved', 'waived', 0, now(), now()
from public.officials official
on conflict do nothing;

alter table public.registration_settings enable row level security;
alter table public.official_registrations enable row level security;

create policy "Registrars manage registration settings"
on public.registration_settings for all to authenticated
using ((select public.can_manage_registrations()))
with check ((select public.can_manage_registrations()));
create policy "Registrars manage registrations"
on public.official_registrations for all to authenticated
using ((select public.can_manage_registrations()))
with check ((select public.can_manage_registrations()));

grant select, insert, update, delete on public.registration_settings to authenticated;
grant select, insert, update, delete on public.official_registrations to authenticated;

create or replace function public.submit_official_registration(
  p_first_name text, p_last_name text, p_email text, p_phone text,
  p_home_address text, p_home_city text, p_home_state text, p_home_zip text,
  p_sport text default 'Soccer'
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_token uuid; v_fee integer;
begin
  if length(trim(coalesce(p_first_name,''))) not between 1 and 80
    or length(trim(coalesce(p_last_name,''))) not between 1 and 80 then
    raise exception 'First and last name are required.';
  end if;
  if trim(coalesce(p_email,'')) !~* '^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$' then
    raise exception 'Enter a valid email address.';
  end if;
  if exists(select 1 from public.official_registrations
    where lower(email)=lower(trim(p_email)) and registration_year=extract(year from current_date)::integer) then
    raise exception 'A registration already exists for this email this year.';
  end if;
  select registration_fee_cents into v_fee from public.registration_settings where id=true;
  insert into public.official_registrations(
    first_name,last_name,email,phone,home_address,home_city,home_state,home_zip,sport,fee_cents
  ) values (
    trim(p_first_name),trim(p_last_name),lower(trim(p_email)),nullif(trim(coalesce(p_phone,'')),''),
    nullif(trim(coalesce(p_home_address,'')),''),nullif(trim(coalesce(p_home_city,'')),''),
    nullif(trim(coalesce(p_home_state,'')),''),nullif(trim(coalesce(p_home_zip,'')),''),
    coalesce(nullif(trim(coalesce(p_sport,'')),''),'Soccer'),v_fee
  ) returning public_token into v_token;
  return v_token;
end;
$$;

create or replace function public.get_registration_status(p_token uuid)
returns table(
  first_name text, last_name text, email text, status text,
  payment_status text, fee_cents integer, registration_year integer
) language sql stable security definer set search_path = '' as $$
  select registration.first_name, registration.last_name, registration.email,
    registration.status, registration.payment_status,
    coalesce(registration.fee_cents, settings.registration_fee_cents),
    registration.registration_year
  from public.official_registrations registration
  cross join public.registration_settings settings
  where registration.public_token = p_token;
$$;

create or replace function public.approve_official_registration(
  p_registration_id uuid, p_level_ids uuid[]
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_registration public.official_registrations; v_official_id uuid;
begin
  if not public.can_manage_registrations() then raise exception 'Not authorized'; end if;
  select * into v_registration from public.official_registrations
  where id=p_registration_id for update;
  if v_registration.id is null then raise exception 'Registration not found'; end if;
  if v_registration.payment_status not in ('paid','waived') then
    raise exception 'Registration payment is not complete';
  end if;
  select id into v_official_id from public.officials
  where lower(email)=lower(v_registration.email) limit 1;
  if v_official_id is null then
    insert into public.officials(
      first_name,last_name,full_name,email,phone,home_address,home_city,
      home_state,home_zip,sports,active
    ) values (
      v_registration.first_name,v_registration.last_name,
      v_registration.first_name||' '||v_registration.last_name,
      v_registration.email,v_registration.phone,v_registration.home_address,
      v_registration.home_city,v_registration.home_state,v_registration.home_zip,
      array[v_registration.sport],true
    ) returning id into v_official_id;
  else
    update public.officials set
      first_name=v_registration.first_name,last_name=v_registration.last_name,
      full_name=v_registration.first_name||' '||v_registration.last_name,
      phone=coalesce(v_registration.phone,phone),
      home_address=coalesce(v_registration.home_address,home_address),
      home_city=coalesce(v_registration.home_city,home_city),
      home_state=coalesce(v_registration.home_state,home_state),
      home_zip=coalesce(v_registration.home_zip,home_zip),active=true
    where id=v_official_id;
  end if;
  delete from public.official_level_eligibility where official_id=v_official_id;
  insert into public.official_level_eligibility(official_id,level_id)
  select v_official_id, requested.level_id
  from unnest(coalesce(p_level_ids,array[]::uuid[])) as requested(level_id)
  join public.levels level on level.id=requested.level_id and level.active=true
  on conflict do nothing;
  update public.official_registrations set official_id=v_official_id,status='approved',
    reviewed_at=now(),reviewed_by=auth.uid(),updated_at=now()
  where id=p_registration_id;
  return v_official_id;
end;
$$;

revoke all on function public.submit_official_registration(text,text,text,text,text,text,text,text,text) from public;
grant execute on function public.submit_official_registration(text,text,text,text,text,text,text,text,text) to anon, authenticated;
revoke all on function public.get_registration_status(uuid) from public;
grant execute on function public.get_registration_status(uuid) to anon, authenticated;
revoke all on function public.approve_official_registration(uuid,uuid[]) from public, anon;
grant execute on function public.approve_official_registration(uuid,uuid[]) to authenticated;
revoke all on function public.can_manage_registrations() from public, anon;
grant execute on function public.can_manage_registrations() to authenticated;
