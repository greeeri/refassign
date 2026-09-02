alter table public.leagues
  add column if not exists mileage_plan text not null default 'round_trip';

alter table public.leagues
  drop constraint if exists leagues_mileage_plan_check;

alter table public.leagues
  add constraint leagues_mileage_plan_check
  check (mileage_plan in ('one_way', 'round_trip', 'actual', 'none'));

create table if not exists public.official_weekday_origins (
  official_id uuid not null references public.officials(id) on delete cascade,
  weekday smallint not null check (weekday between 0 and 6),
  use_home boolean not null default true,
  alternate_label text,
  alternate_address text,
  alternate_city text,
  alternate_state text,
  alternate_zip text,
  alternate_latitude numeric,
  alternate_longitude numeric,
  updated_at timestamptz not null default now(),
  primary key (official_id, weekday)
);

insert into public.official_weekday_origins (official_id, weekday)
select official.id, day.weekday
from public.officials official
cross join generate_series(0, 6) as day(weekday)
on conflict (official_id, weekday) do nothing;

alter table public.official_weekday_origins enable row level security;

drop policy if exists "Officials view own weekday origins"
  on public.official_weekday_origins;
create policy "Officials view own weekday origins"
on public.official_weekday_origins for select to authenticated
using (
  exists (
    select 1 from public.officials official
    where official.id = official_id
      and official.auth_user_id = (select auth.uid())
  )
  or (select public.can_manage_game_setup())
);

drop policy if exists "Officials save own weekday origins"
  on public.official_weekday_origins;
create policy "Officials save own weekday origins"
on public.official_weekday_origins for insert to authenticated
with check (
  exists (
    select 1 from public.officials official
    where official.id = official_id
      and official.auth_user_id = (select auth.uid())
  )
  or (select public.can_manage_game_setup())
);

drop policy if exists "Officials update own weekday origins"
  on public.official_weekday_origins;
create policy "Officials update own weekday origins"
on public.official_weekday_origins for update to authenticated
using (
  exists (
    select 1 from public.officials official
    where official.id = official_id
      and official.auth_user_id = (select auth.uid())
  )
  or (select public.can_manage_game_setup())
)
with check (
  exists (
    select 1 from public.officials official
    where official.id = official_id
      and official.auth_user_id = (select auth.uid())
  )
  or (select public.can_manage_game_setup())
);

grant select, insert, update on public.official_weekday_origins to authenticated;
