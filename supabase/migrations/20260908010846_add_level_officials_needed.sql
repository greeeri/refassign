alter table public.levels
  add column if not exists officials_needed integer not null default 3;

alter table public.levels
  drop constraint if exists levels_officials_needed_check;

alter table public.levels
  add constraint levels_officials_needed_check
  check (officials_needed between 1 and 20);

notify pgrst, 'reload schema';
