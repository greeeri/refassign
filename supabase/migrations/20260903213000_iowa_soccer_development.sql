create table if not exists public.registration_program_officials(
  program_id uuid not null references public.registration_programs(id) on delete cascade,
  official_id uuid not null references public.officials(id) on delete cascade,
  source text not null default 'registrar' check(source in ('registration','registrar')),
  added_by uuid references auth.users(id) on delete set null,
  added_at timestamptz not null default now(),
  primary key(program_id,official_id)
);
create index if not exists registration_program_officials_official_idx
on public.registration_program_officials(official_id,program_id);

create or replace function public.has_registration_program_access(p_program_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(
    select 1 from public.registration_program_officials membership
    join public.officials official on official.id=membership.official_id
    where membership.program_id=p_program_id and official.auth_user_id=(select auth.uid()) and official.active=true
  );
$$;
revoke all on function public.has_registration_program_access(uuid) from public,anon;
grant execute on function public.has_registration_program_access(uuid) to authenticated;

create or replace function public.has_iowa_soccer_development_access()
returns boolean language sql stable security definer set search_path='' as $$
  select exists(
    select 1 from public.registration_programs program
    where program.slug='iowa-soccer' and program.active=true
      and public.has_registration_program_access(program.id)
  );
$$;
revoke all on function public.has_iowa_soccer_development_access() from public,anon;
grant execute on function public.has_iowa_soccer_development_access() to authenticated;

alter table public.registration_program_officials enable row level security;
grant select,insert,delete on public.registration_program_officials to authenticated;
create policy "Program officials read own membership" on public.registration_program_officials
for select to authenticated using(
  exists(select 1 from public.officials official where official.id=official_id and official.auth_user_id=(select auth.uid()))
  or public.can_manage_registration_program(program_id)
);
create policy "Program staff add official membership" on public.registration_program_officials
for insert to authenticated with check(public.can_manage_registration_program(program_id));
create policy "Program staff remove official membership" on public.registration_program_officials
for delete to authenticated using(public.can_manage_registration_program(program_id));

create policy "Program officials read their program" on public.registration_programs
for select to authenticated using(public.has_registration_program_access(id));
create or replace function public.list_development_program_officials(p_program_id uuid)
returns table(id uuid,first_name text,last_name text,email text)
language plpgsql stable security definer set search_path='' as $$
begin
  if not public.can_manage_registration_program(p_program_id) then raise exception 'Not authorized';end if;
  return query select official.id,official.first_name,official.last_name,official.email
  from public.officials official where official.active=true
  order by official.last_name,official.first_name;
end;
$$;
revoke all on function public.list_development_program_officials(uuid) from public,anon;
grant execute on function public.list_development_program_officials(uuid) to authenticated;

create table if not exists public.development_modules(
  id uuid primary key default gen_random_uuid(),
  program_id uuid not null references public.registration_programs(id) on delete cascade,
  title text not null,
  description text not null default '',
  category text not null default 'Training',
  resource_url text,
  sort_order integer not null default 0,
  required boolean not null default true,
  active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists development_modules_program_idx on public.development_modules(program_id,active,sort_order);
alter table public.development_modules enable row level security;
grant select,insert,update,delete on public.development_modules to authenticated;
create policy "Members read development modules" on public.development_modules
for select to authenticated using(public.has_registration_program_access(program_id) or public.can_manage_registration_program(program_id));
create policy "Program staff insert development modules" on public.development_modules
for insert to authenticated with check(public.can_manage_registration_program(program_id));
create policy "Program staff update development modules" on public.development_modules
for update to authenticated using(public.can_manage_registration_program(program_id)) with check(public.can_manage_registration_program(program_id));
create policy "Program staff delete development modules" on public.development_modules
for delete to authenticated using(public.can_manage_registration_program(program_id));

create table if not exists public.official_development_progress(
  module_id uuid not null references public.development_modules(id) on delete cascade,
  official_id uuid not null references public.officials(id) on delete cascade,
  status text not null default 'not_started' check(status in ('not_started','in_progress','completed')),
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key(module_id,official_id)
);
create index if not exists official_development_progress_official_idx on public.official_development_progress(official_id,status);
alter table public.official_development_progress enable row level security;
grant select,insert,update on public.official_development_progress to authenticated;
create policy "Officials read own development progress" on public.official_development_progress
for select to authenticated using(
  exists(select 1 from public.officials official where official.id=official_id and official.auth_user_id=(select auth.uid()))
  or exists(select 1 from public.development_modules module where module.id=module_id and public.can_manage_registration_program(module.program_id))
);
create policy "Officials start own development progress" on public.official_development_progress
for insert to authenticated with check(
  exists(select 1 from public.officials official join public.registration_program_officials membership on membership.official_id=official.id
    join public.development_modules module on module.program_id=membership.program_id
    where official.id=official_id and official.auth_user_id=(select auth.uid()) and module.id=module_id)
);
create policy "Officials update own development progress" on public.official_development_progress
for update to authenticated using(
  exists(select 1 from public.officials official where official.id=official_id and official.auth_user_id=(select auth.uid()))
) with check(
  exists(select 1 from public.officials official where official.id=official_id and official.auth_user_id=(select auth.uid()))
);

create table if not exists public.development_announcements(
  id uuid primary key default gen_random_uuid(),
  program_id uuid not null references public.registration_programs(id) on delete cascade,
  title text not null,
  message text not null,
  published_at timestamptz not null default now(),
  active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null
);
create index if not exists development_announcements_program_idx on public.development_announcements(program_id,active,published_at desc);
alter table public.development_announcements enable row level security;
grant select,insert,update,delete on public.development_announcements to authenticated;
create policy "Members read development announcements" on public.development_announcements
for select to authenticated using(public.has_registration_program_access(program_id) or public.can_manage_registration_program(program_id));
create policy "Program staff insert development announcements" on public.development_announcements
for insert to authenticated with check(public.can_manage_registration_program(program_id));
create policy "Program staff update development announcements" on public.development_announcements
for update to authenticated using(public.can_manage_registration_program(program_id)) with check(public.can_manage_registration_program(program_id));
create policy "Program staff delete development announcements" on public.development_announcements
for delete to authenticated using(public.can_manage_registration_program(program_id));

insert into public.development_modules(program_id,title,description,category,sort_order,required)
select program.id,module.title,module.description,module.category,module.sort_order,true
from public.registration_programs program
cross join(values
  ('Welcome to Iowa Soccer Officiating','Learn how the development program works and what to expect on your first assignments.','Getting Started',10),
  ('Laws of the Game Foundations','Build confidence with the core laws, restarts, positioning, and match authority.','Rules',20),
  ('Match-Day Readiness','Prepare equipment, uniform, arrival routine, field inspection, and pregame responsibilities.','Preparation',30),
  ('Assistant Referee Basics','Practice signals, positioning, offside awareness, eye contact, and teamwork.','On-Field Skills',40),
  ('Communication and Confidence','Use a whistle, voice, presence, and calm communication appropriate for youth matches.','On-Field Skills',50),
  ('Safety and Concussion Awareness','Recognize safety concerns and follow the correct injury and concussion procedures.','Safety',60)
) as module(title,description,category,sort_order)
where program.slug='iowa-soccer'
and not exists(select 1 from public.development_modules existing where existing.program_id=program.id and existing.title=module.title);

insert into public.registration_program_officials(program_id,official_id,source,added_by)
select registration.registration_program_id,registration.official_id,'registration',registration.reviewed_by
from public.official_registrations registration
where registration.status='approved' and registration.payment_status='paid'
  and registration.registration_program_id is not null and registration.official_id is not null
on conflict do nothing;

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
  insert into public.registration_program_officials(program_id,official_id,source,added_by)
  values(v_registration.registration_program_id,v_official_id,'registration',auth.uid()) on conflict do nothing;
  insert into public.official_level_eligibility(official_id,level_id)
  select v_official_id,requested.level_id from unnest(coalesce(p_level_ids,array[]::uuid[])) requested(level_id)
  join public.levels level on level.id=requested.level_id and level.active=true on conflict do nothing;
  update public.official_registrations set official_id=v_official_id,status='approved',reviewed_at=now(),reviewed_by=auth.uid(),updated_at=now()
  where id=p_registration_id;
  return v_official_id;
end;
$$;
