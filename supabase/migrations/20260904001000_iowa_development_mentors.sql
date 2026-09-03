create table if not exists public.development_mentors(
  program_id uuid not null references public.registration_programs(id) on delete cascade,
  official_id uuid not null references public.officials(id) on delete cascade,
  added_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key(program_id,official_id)
);

create or replace function public.is_iowa_soccer_development_mentor()
returns boolean language sql stable security definer set search_path='' as $$
  select exists(
    select 1 from public.development_mentors mentor
    join public.registration_programs program on program.id=mentor.program_id
    join public.officials official on official.id=mentor.official_id
    where program.slug='iowa-soccer' and program.active=true
      and official.auth_user_id=(select auth.uid()) and official.active=true
  );
$$;
revoke all on function public.is_iowa_soccer_development_mentor() from public,anon;
grant execute on function public.is_iowa_soccer_development_mentor() to authenticated;

create or replace function public.can_access_iowa_development_records()
returns boolean language sql stable security definer set search_path='' as $$
  select public.is_iowa_soccer_development_staff() or public.is_iowa_soccer_development_mentor();
$$;
revoke all on function public.can_access_iowa_development_records() from public,anon;
grant execute on function public.can_access_iowa_development_records() to authenticated;

alter table public.development_mentors enable row level security;
grant select,insert,delete on public.development_mentors to authenticated;
create policy "Development team reads mentors" on public.development_mentors
for select to authenticated using(public.can_access_iowa_development_records());
create policy "Development staff adds mentors" on public.development_mentors
for insert to authenticated with check(public.is_iowa_soccer_development_staff());
create policy "Development staff removes mentors" on public.development_mentors
for delete to authenticated using(public.is_iowa_soccer_development_staff());

create table if not exists public.official_development_notes(
  id uuid primary key default gen_random_uuid(),
  program_id uuid not null references public.registration_programs(id) on delete cascade,
  official_id uuid not null references public.officials(id) on delete cascade,
  author_user_id uuid not null references auth.users(id) on delete restrict default auth.uid(),
  author_name text not null,
  note text not null check(length(trim(note)) between 1 and 5000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists official_development_notes_card_idx on public.official_development_notes(program_id,official_id,created_at desc);
alter table public.official_development_notes enable row level security;
grant select,insert on public.official_development_notes to authenticated;
create policy "Development team reads notes" on public.official_development_notes
for select to authenticated using(public.can_access_iowa_development_records());
create policy "Development team adds notes" on public.official_development_notes
for insert to authenticated with check(
  public.can_access_iowa_development_records()
  and author_user_id=(select auth.uid())
  and exists(select 1 from public.registration_program_officials membership where membership.program_id=program_id and membership.official_id=official_id)
);

create table if not exists public.development_communications(
  id uuid primary key default gen_random_uuid(),
  program_id uuid not null references public.registration_programs(id) on delete cascade,
  official_id uuid not null references public.officials(id) on delete cascade,
  channel text not null check(channel in ('email','text')),
  recipient text,
  subject text,
  message text not null,
  delivery_status text not null default 'queued' check(delivery_status in ('queued','sent','delivered','opened','failed')),
  provider_message_id text,
  error_message text,
  sent_by uuid not null references auth.users(id) on delete restrict,
  sent_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists development_communications_program_idx on public.development_communications(program_id,created_at desc);
alter table public.development_communications enable row level security;
grant select on public.development_communications to authenticated;
create policy "Development team reads communications" on public.development_communications
for select to authenticated using(public.can_access_iowa_development_records());

create or replace function public.list_iowa_development_people()
returns table(id uuid,first_name text,last_name text,email text,phone text,profile_picture_url text,is_mentor boolean,note_count bigint)
language plpgsql stable security definer set search_path='' as $$
begin
  if not public.can_access_iowa_development_records() then raise exception 'Not authorized';end if;
  return query
  select official.id,official.first_name,official.last_name,official.email,official.phone,official.profile_picture_url,
    exists(select 1 from public.development_mentors mentor where mentor.program_id=program.id and mentor.official_id=official.id),
    (select count(*) from public.official_development_notes note where note.program_id=program.id and note.official_id=official.id)
  from public.registration_programs program
  join public.registration_program_officials membership on membership.program_id=program.id
  join public.officials official on official.id=membership.official_id
  where program.slug='iowa-soccer' and official.active=true
  order by official.last_name,official.first_name;
end;
$$;
revoke all on function public.list_iowa_development_people() from public,anon;
grant execute on function public.list_iowa_development_people() to authenticated;
