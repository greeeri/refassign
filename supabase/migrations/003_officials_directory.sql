-- Live officials directory, independent of whether an official has created a login yet.

create table if not exists public.officials (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique references auth.users(id) on delete set null,
  full_name text not null,
  email text,
  phone text,
  home_area text,
  sports text[] not null default array['Soccer']::text[],
  certification_level text,
  max_games_per_day int not null default 2,
  active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.is_refassign_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role in ('admin','scheduler') and active = true
  );
$$;

alter table public.officials enable row level security;

drop policy if exists "Staff manage officials" on public.officials;
create policy "Staff manage officials"
on public.officials
for all
to authenticated
using (public.is_refassign_staff())
with check (public.is_refassign_staff());

drop policy if exists "Officials view own directory record" on public.officials;
create policy "Officials view own directory record"
on public.officials
for select
to authenticated
using (auth_user_id = auth.uid() or public.is_refassign_staff());

create index if not exists officials_full_name_idx on public.officials(full_name);
create index if not exists officials_active_idx on public.officials(active);
