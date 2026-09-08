alter table public.leagues
  add column if not exists mileage_plan text not null default 'round_trip';

alter table public.leagues
  drop constraint if exists leagues_mileage_plan_check;

alter table public.leagues
  add constraint leagues_mileage_plan_check
  check (mileage_plan in ('one_way', 'round_trip', 'actual', 'none'));
