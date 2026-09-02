create table if not exists public.official_calendar_tokens (
  id uuid primary key default gen_random_uuid(),
  official_id uuid not null unique references public.officials(id) on delete cascade,
  token uuid not null unique default gen_random_uuid(),
  created_at timestamptz not null default now(),
  rotated_at timestamptz
);

alter table public.official_calendar_tokens enable row level security;

create policy "Officials view own calendar token" on public.official_calendar_tokens
for select to authenticated
using (exists (
  select 1 from public.officials official
  where official.id = official_id and official.auth_user_id = (select auth.uid())
));

create policy "Officials create own calendar token" on public.official_calendar_tokens
for insert to authenticated
with check (exists (
  select 1 from public.officials official
  where official.id = official_id and official.auth_user_id = (select auth.uid())
));

create policy "Officials rotate own calendar token" on public.official_calendar_tokens
for update to authenticated
using (exists (
  select 1 from public.officials official
  where official.id = official_id and official.auth_user_id = (select auth.uid())
))
with check (exists (
  select 1 from public.officials official
  where official.id = official_id and official.auth_user_id = (select auth.uid())
));

grant select, insert, update on public.official_calendar_tokens to authenticated;

create or replace function public.get_or_create_calendar_token()
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare v_official_id uuid; v_token uuid;
begin
  select id into v_official_id from public.officials where auth_user_id = auth.uid();
  if v_official_id is null then raise exception 'Your login is not linked to an official'; end if;
  insert into public.official_calendar_tokens(official_id)
  values(v_official_id)
  on conflict(official_id) do update set official_id=excluded.official_id
  returning token into v_token;
  return v_token;
end;
$$;

create or replace function public.rotate_calendar_token()
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare v_official_id uuid; v_token uuid;
begin
  select id into v_official_id from public.officials where auth_user_id = auth.uid();
  if v_official_id is null then raise exception 'Your login is not linked to an official'; end if;
  insert into public.official_calendar_tokens(official_id,token,rotated_at)
  values(v_official_id,gen_random_uuid(),now())
  on conflict(official_id) do update set token=gen_random_uuid(),rotated_at=now()
  returning token into v_token;
  return v_token;
end;
$$;

revoke all on function public.get_or_create_calendar_token() from public, anon;
revoke all on function public.rotate_calendar_token() from public, anon;
grant execute on function public.get_or_create_calendar_token() to authenticated;
grant execute on function public.rotate_calendar_token() to authenticated;
