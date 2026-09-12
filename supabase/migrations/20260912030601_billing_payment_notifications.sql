create table if not exists public.billing_notification_log (
  id uuid primary key default gen_random_uuid(),
  stripe_event_id text not null,
  subscription_id uuid references public.refassign_subscriptions(id) on delete set null,
  organization_id uuid references public.organizations(id) on delete set null,
  notification_type text not null check (notification_type in (
    'payment_failed_customer',
    'payment_failed_admin',
    'payment_recovered_customer',
    'payment_recovered_admin'
  )),
  recipient_email text not null,
  delivery_status text not null check (delivery_status in ('sent', 'failed')),
  provider_message_id text,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (stripe_event_id, notification_type, recipient_email)
);

alter table public.billing_notification_log enable row level security;
revoke all on public.billing_notification_log from public, anon, authenticated;

create index if not exists billing_notification_log_subscription_idx
  on public.billing_notification_log(subscription_id, created_at desc);

create index if not exists billing_notification_log_organization_idx
  on public.billing_notification_log(organization_id, created_at desc);

notify pgrst, 'reload schema';
