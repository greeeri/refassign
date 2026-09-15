-- Organization-level Stripe Connect recipients and registration payment ledger.

create table if not exists public.organization_stripe_accounts (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  stripe_mode text not null check (stripe_mode in ('sandbox','live')),
  stripe_account_id text not null,
  dashboard_type text not null default 'express' check (dashboard_type = 'express'),
  onboarding_status text not null default 'not_started'
    check (onboarding_status in ('not_started','pending','restricted','ready','disabled')),
  transfers_status text not null default 'inactive'
    check (transfers_status in ('inactive','pending','active','restricted')),
  requirements_due jsonb not null default '[]'::jsonb,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, stripe_mode),
  unique (stripe_account_id, stripe_mode)
);

create table if not exists public.organization_registration_payment_settings (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  payments_enabled boolean not null default false,
  platform_fee_cents integer not null default 300 check (platform_fee_cents >= 0),
  processing_fee_payer text not null default 'registrant'
    check (processing_fee_payer in ('registrant','organization','platform')),
  refund_decision_owner text not null default 'organization'
    check (refund_decision_owner in ('organization','platform','shared')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

alter table public.official_registrations
  add column if not exists organization_id uuid references public.organizations(id) on delete restrict,
  add column if not exists registration_amount_cents integer check (registration_amount_cents is null or registration_amount_cents >= 0),
  add column if not exists platform_fee_cents integer check (platform_fee_cents is null or platform_fee_cents >= 0),
  add column if not exists processing_surcharge_cents integer check (processing_surcharge_cents is null or processing_surcharge_cents >= 0),
  add column if not exists total_charged_cents integer check (total_charged_cents is null or total_charged_cents >= 0),
  add column if not exists stripe_application_fee_amount integer check (stripe_application_fee_amount is null or stripe_application_fee_amount >= 0),
  add column if not exists stripe_destination_account_id text,
  add column if not exists stripe_charge_id text,
  add column if not exists stripe_transfer_id text,
  add column if not exists refunded_amount_cents integer not null default 0 check (refunded_amount_cents >= 0);

update public.official_registrations registration
set organization_id = program.organization_id
from public.registration_programs program
where registration.registration_program_id = program.id
  and registration.organization_id is null;

create index if not exists organization_stripe_accounts_account_idx
  on public.organization_stripe_accounts(stripe_account_id, stripe_mode);
create index if not exists official_registrations_organization_payment_idx
  on public.official_registrations(organization_id, payment_status, created_at desc);

alter table public.organization_stripe_accounts enable row level security;
alter table public.organization_registration_payment_settings enable row level security;

revoke all on public.organization_stripe_accounts from anon, authenticated;
revoke all on public.organization_registration_payment_settings from anon, authenticated;

insert into public.organization_registration_payment_settings(
  organization_id, payments_enabled, platform_fee_cents, processing_fee_payer, refund_decision_owner
)
select distinct organization_id, false, 300, 'registrant', 'organization'
from public.registration_programs
where organization_id is not null
on conflict (organization_id) do nothing;
