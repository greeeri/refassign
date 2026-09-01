create table if not exists public.import_error_log (
  id bigint generated always as identity primary key,
  import_type text not null,
  file_name text,
  error_message text not null,
  row_number integer,
  resolved_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists import_error_log_unresolved_idx on public.import_error_log(created_at desc) where resolved_at is null;
alter table public.import_error_log enable row level security;
drop policy if exists "Managers manage import errors" on public.import_error_log;
create policy "Managers manage import errors" on public.import_error_log for all to authenticated using ((select public.can_manage_game_setup())) with check ((select public.can_manage_game_setup()));
grant select,insert,update on public.import_error_log to authenticated;
