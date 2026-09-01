alter table public.assignments
  add column if not exists reminder_sent_at timestamptz;

create index if not exists assignments_automatic_reminder_idx
  on public.assignments (reminder_sent_at, game_id)
  where published_at is not null
    and status not in ('declined', 'cancelled');
