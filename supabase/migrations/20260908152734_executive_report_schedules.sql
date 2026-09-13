create table public.executive_report_schedules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  recipient_email text not null,
  frequency text not null default 'weekly' check (frequency in ('weekly', 'monthly')),
  send_day smallint not null default 1 check (send_day between 0 and 28),
  enabled boolean not null default false,
  kpi_targets jsonb not null default '{"coverage":95,"compliance":95,"delivery":95,"training":90}'::jsonb,
  last_sent_at timestamptz,
  next_send_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, user_id)
);

alter table public.executive_report_schedules enable row level security;
revoke all on public.executive_report_schedules from anon, authenticated;

create index executive_report_schedules_due_idx
  on public.executive_report_schedules (next_send_at)
  where enabled;

comment on table public.executive_report_schedules is
  'Service-mediated premium executive report preferences and scheduled PDF delivery.';
