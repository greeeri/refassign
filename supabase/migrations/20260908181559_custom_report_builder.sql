create table public.custom_report_templates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 100),
  definition jsonb not null default '{}'::jsonb,
  recipient_email text,
  frequency text not null default 'weekly' check (frequency in ('weekly','monthly')),
  send_day smallint not null default 1 check (send_day between 0 and 28),
  schedule_enabled boolean not null default false,
  last_sent_at timestamptz,
  next_send_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.custom_report_templates enable row level security;
revoke all on table public.custom_report_templates from anon, authenticated;

create index custom_report_templates_owner_idx
  on public.custom_report_templates(user_id, organization_id, updated_at desc);

create index custom_report_templates_due_idx
  on public.custom_report_templates(next_send_at)
  where schedule_enabled;

comment on table public.custom_report_templates is
  'Service-mediated Premium Reporting templates and scheduled delivery settings.';
