alter table public.leagues
  add column if not exists assignment_fill_target_days integer not null default 14
    check (assignment_fill_target_days between 0 and 90),
  add column if not exists assignment_acceptance_hours integer not null default 24
    check (assignment_acceptance_hours between 1 and 168),
  add column if not exists assignment_escalation_days integer not null default 3
    check (assignment_escalation_days between 0 and 30),
  add column if not exists assignment_reminder_hours integer not null default 24
    check (assignment_reminder_hours between 1 and 168);

create table public.assignment_saved_views (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  filters jsonb not null default '{}'::jsonb check (jsonb_typeof(filters) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, name)
);

create index assignment_saved_views_user_updated_idx
  on public.assignment_saved_views (user_id, updated_at desc);

alter table public.assignment_saved_views enable row level security;
revoke all on public.assignment_saved_views from anon;
grant select, insert, update, delete on public.assignment_saved_views to authenticated;

create policy "Managers view their assignment views"
on public.assignment_saved_views for select to authenticated
using (
  user_id = (select auth.uid())
  and (select public.can_manage_game_setup())
);

create policy "Managers create their assignment views"
on public.assignment_saved_views for insert to authenticated
with check (
  user_id = (select auth.uid())
  and (select public.can_manage_game_setup())
);

create policy "Managers update their assignment views"
on public.assignment_saved_views for update to authenticated
using (
  user_id = (select auth.uid())
  and (select public.can_manage_game_setup())
)
with check (
  user_id = (select auth.uid())
  and (select public.can_manage_game_setup())
);

create policy "Managers delete their assignment views"
on public.assignment_saved_views for delete to authenticated
using (
  user_id = (select auth.uid())
  and (select public.can_manage_game_setup())
);
