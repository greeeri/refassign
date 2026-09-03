create table if not exists public.registration_programs (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9-]+$'),
  name text not null,
  registration_fee_cents integer check (registration_fee_cents is null or registration_fee_cents > 0),
  registration_open boolean not null default true,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);
alter table public.registration_programs enable row level security;
grant select,insert,update,delete on public.registration_programs to authenticated;

insert into public.registration_programs(slug,name,registration_open,active)
values('iowa-soccer','Iowa Soccer',true,true)
on conflict(slug) do update set name=excluded.name,active=true;

create table if not exists public.registration_program_staff (
  user_id uuid not null references auth.users(id) on delete cascade,
  program_id uuid not null references public.registration_programs(id) on delete cascade,
  role text not null check (role in ('admin','registrar')),
  created_at timestamptz not null default now(),
  primary key(user_id,program_id,role)
);
alter table public.registration_program_staff enable row level security;
grant select on public.registration_program_staff to authenticated;

create or replace function public.can_manage_registration_program(p_program_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select public.is_super_admin() or exists(
    select 1 from public.registration_program_staff access
    join public.profiles profile on profile.id=access.user_id
    where access.user_id=(select auth.uid()) and access.program_id=p_program_id
      and access.role in ('admin','registrar') and profile.active=true
  );
$$;
revoke all on function public.can_manage_registration_program(uuid) from public,anon;
grant execute on function public.can_manage_registration_program(uuid) to authenticated;

create policy "Registration staff read own program access" on public.registration_program_staff
for select to authenticated using(user_id=(select auth.uid()) or (select public.is_super_admin()));
create policy "Registration staff read programs" on public.registration_programs
for select to authenticated using(public.can_manage_registration_program(id));
create policy "Registration staff update programs" on public.registration_programs
for update to authenticated using(public.can_manage_registration_program(id))
with check(public.can_manage_registration_program(id));

alter table public.official_registrations
add column if not exists registration_program_id uuid references public.registration_programs(id) on delete restrict;
drop index if exists public.official_registrations_email_year_league_idx;
create unique index if not exists official_registrations_email_year_program_idx
on public.official_registrations(lower(email),registration_year,registration_program_id)
where registration_program_id is not null;

drop policy if exists "League staff manage registrations" on public.official_registrations;
create policy "Registration staff manage registrations" on public.official_registrations
for all to authenticated
using(registration_program_id is not null and public.can_manage_registration_program(registration_program_id))
with check(registration_program_id is not null and public.can_manage_registration_program(registration_program_id));

create or replace function public.get_public_registration_program(p_slug text)
returns table(id uuid,name text,slug text,fee_cents integer)
language sql stable security definer set search_path='' as $$
  select program.id,program.name,program.slug,program.registration_fee_cents
  from public.registration_programs program
  where program.slug=p_slug and program.active=true and program.registration_open=true;
$$;
revoke all on function public.get_public_registration_program(text) from public;
grant execute on function public.get_public_registration_program(text) to anon,authenticated;

drop function if exists public.submit_official_registration(text,text,text,text,text,text,text,text,text,uuid);
create function public.submit_official_registration(
  p_first_name text,p_last_name text,p_email text,p_phone text,
  p_home_address text,p_home_city text,p_home_state text,p_home_zip text,
  p_sport text,p_program_slug text default 'iowa-soccer'
)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_token uuid;v_program public.registration_programs;
begin
  if length(trim(coalesce(p_first_name,''))) not between 1 and 80
    or length(trim(coalesce(p_last_name,''))) not between 1 and 80 then raise exception 'First and last name are required.';end if;
  if trim(coalesce(p_email,'')) !~* '^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$' then raise exception 'Enter a valid email address.';end if;
  select * into v_program from public.registration_programs
  where slug=p_program_slug and active=true and registration_open=true;
  if v_program.id is null then raise exception 'This registration page is not open.';end if;
  if exists(select 1 from public.official_registrations where lower(email)=lower(trim(p_email))
    and registration_year=extract(year from current_date)::integer and registration_program_id=v_program.id)
    then raise exception 'A registration already exists for this email this year.';end if;
  insert into public.official_registrations(first_name,last_name,email,phone,home_address,home_city,
    home_state,home_zip,sport,fee_cents,registration_program_id,league_id,status,payment_status)
  values(trim(p_first_name),trim(p_last_name),lower(trim(p_email)),nullif(trim(coalesce(p_phone,'')),''),
    nullif(trim(coalesce(p_home_address,'')),''),nullif(trim(coalesce(p_home_city,'')),''),
    nullif(trim(coalesce(p_home_state,'')),''),nullif(trim(coalesce(p_home_zip,'')),''),
    coalesce(nullif(trim(coalesce(p_sport,'')),''),'Soccer'),v_program.registration_fee_cents,v_program.id,null,
    'payment_pending','pending') returning public_token into v_token;
  return v_token;
end;
$$;
revoke all on function public.submit_official_registration(text,text,text,text,text,text,text,text,text,text) from public;
grant execute on function public.submit_official_registration(text,text,text,text,text,text,text,text,text,text) to anon,authenticated;

drop function if exists public.get_registration_status(uuid);
create function public.get_registration_status(p_token uuid)
returns table(first_name text,last_name text,email text,status text,payment_status text,
  fee_cents integer,registration_year integer,program_name text)
language sql stable security definer set search_path='' as $$
  select registration.first_name,registration.last_name,registration.email,registration.status,
    registration.payment_status,coalesce(registration.fee_cents,program.registration_fee_cents),
    registration.registration_year,program.name
  from public.official_registrations registration
  join public.registration_programs program on program.id=registration.registration_program_id
  where registration.public_token=p_token;
$$;
revoke all on function public.get_registration_status(uuid) from public;
grant execute on function public.get_registration_status(uuid) to anon,authenticated;

create or replace function public.mark_registration_paid(p_registration_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare v_registration public.official_registrations;
begin
  select * into v_registration from public.official_registrations where id=p_registration_id for update;
  if v_registration.id is null then raise exception 'Registration not found';end if;
  if not public.can_manage_registration_program(v_registration.registration_program_id) then raise exception 'Not authorized';end if;
  update public.official_registrations set payment_status='paid',status='paid',paid_at=coalesce(paid_at,now()),updated_at=now()
  where id=p_registration_id;
end;
$$;

create or replace function public.approve_official_registration(p_registration_id uuid,p_level_ids uuid[])
returns uuid language plpgsql security definer set search_path='' as $$
declare v_registration public.official_registrations;v_official_id uuid;
begin
  select * into v_registration from public.official_registrations where id=p_registration_id for update;
  if v_registration.id is null then raise exception 'Registration not found';end if;
  if not public.can_manage_registration_program(v_registration.registration_program_id) then raise exception 'Not authorized';end if;
  if v_registration.payment_status<>'paid' then raise exception 'Registration must be marked paid before approval';end if;
  select id into v_official_id from public.officials where lower(email)=lower(v_registration.email) limit 1;
  if v_official_id is null then
    insert into public.officials(first_name,last_name,full_name,email,phone,home_address,home_city,home_state,home_zip,sports,active)
    values(v_registration.first_name,v_registration.last_name,v_registration.first_name||' '||v_registration.last_name,
      v_registration.email,v_registration.phone,v_registration.home_address,v_registration.home_city,
      v_registration.home_state,v_registration.home_zip,array[v_registration.sport],true) returning id into v_official_id;
  else
    update public.officials set first_name=v_registration.first_name,last_name=v_registration.last_name,
      full_name=v_registration.first_name||' '||v_registration.last_name,phone=coalesce(v_registration.phone,phone),
      home_address=coalesce(v_registration.home_address,home_address),home_city=coalesce(v_registration.home_city,home_city),
      home_state=coalesce(v_registration.home_state,home_state),home_zip=coalesce(v_registration.home_zip,home_zip),active=true
    where id=v_official_id;
  end if;
  insert into public.official_level_eligibility(official_id,level_id)
  select v_official_id,requested.level_id from unnest(coalesce(p_level_ids,array[]::uuid[])) requested(level_id)
  join public.levels level on level.id=requested.level_id and level.active=true on conflict do nothing;
  update public.official_registrations set official_id=v_official_id,status='approved',reviewed_at=now(),
    reviewed_by=auth.uid(),updated_at=now() where id=p_registration_id;
  return v_official_id;
end;
$$;
