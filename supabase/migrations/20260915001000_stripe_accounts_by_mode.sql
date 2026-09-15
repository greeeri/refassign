alter table public.official_stripe_accounts
  add column if not exists stripe_mode text not null default 'sandbox'
  check (stripe_mode in ('sandbox', 'live'));

alter table public.official_stripe_accounts
  drop constraint if exists official_stripe_accounts_pkey;

alter table public.official_stripe_accounts
  add constraint official_stripe_accounts_pkey primary key (official_id, stripe_mode);

create index if not exists official_stripe_accounts_mode_status_idx
  on public.official_stripe_accounts (stripe_mode, onboarding_status, transfers_status, payouts_status);

alter table public.payroll_batches
  add column if not exists stripe_mode text not null default 'sandbox'
  check (stripe_mode in ('sandbox', 'live'));

create index if not exists payroll_batches_mode_status_idx
  on public.payroll_batches (stripe_mode, status, updated_at);
