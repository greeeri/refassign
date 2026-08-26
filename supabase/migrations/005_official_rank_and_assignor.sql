-- Add an explicit Assignor role and a private official Rank visible only to Admins/Assignors.
-- Rank is stored separately so officials cannot read it through their own directory record.

alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles
  add constraint profiles_role_check
  check (role in ('admin','assignor','scheduler','official','school'));

create or replace function public.is_refassign_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid()
      and role in ('admin','assignor','scheduler')
      and active = true
  );
$$;

create or replace function public.can_manage_rank()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid()
      and role in ('admin','assignor','scheduler')
      and active = true
  );
$$;

create table if not exists public.official_rankings (
  official_id uuid primary key references public.officials(id) on delete cascade,
  rank numeric(3,1) not null default 10.0 check (rank >= 1.0 and rank <= 10.0),
  updated_at timestamptz not null default now()
);

insert into public.official_rankings (official_id, rank)
select id, 10.0 from public.officials
on conflict (official_id) do nothing;

create or replace function public.create_default_official_rank()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.official_rankings (official_id, rank)
  values (new.id, 10.0)
  on conflict (official_id) do nothing;
  return new;
end;
$$;

drop trigger if exists officials_create_default_rank on public.officials;
create trigger officials_create_default_rank
after insert on public.officials
for each row execute procedure public.create_default_official_rank();

alter table public.official_rankings enable row level security;

drop policy if exists "Admins and assignors view ranks" on public.official_rankings;
create policy "Admins and assignors view ranks"
on public.official_rankings
for select
to authenticated
using (public.can_manage_rank());

drop policy if exists "Admins and assignors update ranks" on public.official_rankings;
create policy "Admins and assignors update ranks"
on public.official_rankings
for update
to authenticated
using (public.can_manage_rank())
with check (public.can_manage_rank());

drop policy if exists "Admins and assignors insert ranks" on public.official_rankings;
create policy "Admins and assignors insert ranks"
on public.official_rankings
for insert
to authenticated
with check (public.can_manage_rank());
