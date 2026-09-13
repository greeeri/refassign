-- Phase 1: Stripe Connect payroll data foundation.
-- This migration stores configuration and ledger data only. It does not move money.

create table if not exists public.transaction_fee_rules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  league_id uuid references public.leagues(id) on delete cascade,
  transaction_type text not null check (transaction_type in ('payroll','registration','invoice','other')),
  fee_type text not null default 'none' check (fee_type in ('none','flat','percentage')),
  flat_fee_cents bigint check (flat_fee_cents is null or flat_fee_cents >= 0),
  percentage_basis_points integer check (percentage_basis_points is null or percentage_basis_points between 0 and 10000),
  minimum_fee_cents bigint check (minimum_fee_cents is null or minimum_fee_cents >= 0),
  maximum_fee_cents bigint check (maximum_fee_cents is null or maximum_fee_cents >= 0),
  active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (fee_type = 'none' and flat_fee_cents is null and percentage_basis_points is null)
    or (fee_type = 'flat' and flat_fee_cents is not null and percentage_basis_points is null)
    or (fee_type = 'percentage' and flat_fee_cents is null and percentage_basis_points is not null)
  ),
  check (maximum_fee_cents is null or minimum_fee_cents is null or maximum_fee_cents >= minimum_fee_cents)
);

create unique index if not exists transaction_fee_rules_scope_idx
  on public.transaction_fee_rules (
    organization_id,
    coalesce(league_id, '00000000-0000-0000-0000-000000000000'::uuid),
    transaction_type
  );

create table if not exists public.league_payment_settings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  league_id uuid not null references public.leagues(id) on delete cascade,
  payroll_enabled boolean not null default false,
  funding_model text not null default 'per_batch' check (funding_model in ('per_batch','collected_funds','prepaid_balance')),
  default_funding_method text not null default 'ach' check (default_funding_method in ('ach','card','collected_funds','prepaid_balance')),
  ach_enabled boolean not null default true,
  card_enabled boolean not null default false,
  stripe_customer_id text,
  stripe_default_payment_method_id text,
  payroll_hold boolean not null default false,
  payroll_hold_reason text,
  payroll_hold_at timestamptz,
  payroll_hold_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, league_id),
  check (not card_enabled or payroll_enabled),
  check (not payroll_hold or payroll_hold_at is not null)
);

create table if not exists public.official_stripe_accounts (
  official_id uuid primary key references public.officials(id) on delete cascade,
  stripe_account_id text unique,
  dashboard_type text not null default 'express' check (dashboard_type = 'express'),
  onboarding_status text not null default 'not_started'
    check (onboarding_status in ('not_started','pending','restricted','ready','disabled')),
  transfers_status text not null default 'inactive'
    check (transfers_status in ('inactive','pending','active','restricted')),
  payouts_status text not null default 'inactive'
    check (payouts_status in ('inactive','pending','active','restricted')),
  requirements_due jsonb not null default '[]'::jsonb,
  details_submitted boolean not null default false,
  charges_enabled boolean not null default false,
  payouts_enabled boolean not null default false,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.payroll_batches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  league_id uuid not null references public.leagues(id) on delete restrict,
  batch_number bigint generated always as identity,
  status text not null default 'draft' check (status in (
    'draft','approved','funding','settled','paying','partially_paid','paid',
    'funding_failed','returned','on_hold','void'
  )),
  currency text not null default 'usd' check (currency = lower(currency) and length(currency) = 3),
  payroll_subtotal_cents bigint not null default 0 check (payroll_subtotal_cents >= 0),
  stripe_processing_cost_cents bigint not null default 0 check (stripe_processing_cost_cents >= 0),
  refassign_fee_cents bigint not null default 0 check (refassign_fee_cents >= 0),
  total_funding_cents bigint not null default 0 check (total_funding_cents >= 0),
  fee_type_snapshot text not null default 'none' check (fee_type_snapshot in ('none','flat','percentage')),
  fee_value_snapshot numeric(12,4) not null default 0 check (fee_value_snapshot >= 0),
  fee_minimum_cents_snapshot bigint,
  fee_maximum_cents_snapshot bigint,
  funding_method text check (funding_method in ('ach','card','collected_funds','prepaid_balance')),
  stripe_payment_intent_id text unique,
  stripe_charge_id text unique,
  stripe_balance_transaction_id text,
  idempotency_key text unique not null,
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  locked_at timestamptz,
  funded_at timestamptz,
  settled_at timestamptz,
  paid_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (fee_minimum_cents_snapshot is null or fee_minimum_cents_snapshot >= 0),
  check (fee_maximum_cents_snapshot is null or fee_maximum_cents_snapshot >= 0),
  check (fee_maximum_cents_snapshot is null or fee_minimum_cents_snapshot is null or fee_maximum_cents_snapshot >= fee_minimum_cents_snapshot),
  check (total_funding_cents = payroll_subtotal_cents + stripe_processing_cost_cents + refassign_fee_cents),
  check (
    (status = 'draft' and locked_at is null)
    or (status <> 'draft' and locked_at is not null)
  ),
  unique (organization_id, batch_number)
);

create table if not exists public.payroll_batch_items (
  id uuid primary key default gen_random_uuid(),
  payroll_batch_id uuid not null references public.payroll_batches(id) on delete restrict,
  assignment_id uuid not null references public.assignments(id) on delete restrict,
  official_id uuid not null references public.officials(id) on delete restrict,
  official_name_snapshot text not null,
  game_id uuid not null references public.games(id) on delete restrict,
  game_fee_cents bigint not null default 0 check (game_fee_cents >= 0),
  mileage_miles_snapshot numeric(10,2) not null default 0 check (mileage_miles_snapshot >= 0),
  mileage_rate_cents_snapshot integer not null default 0 check (mileage_rate_cents_snapshot >= 0),
  mileage_amount_cents bigint not null default 0 check (mileage_amount_cents >= 0),
  adjustment_cents bigint not null default 0,
  total_cents bigint not null check (total_cents >= 0),
  memo text,
  created_at timestamptz not null default now(),
  unique (assignment_id)
);

create table if not exists public.payment_transactions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  league_id uuid references public.leagues(id) on delete restrict,
  transaction_type text not null check (transaction_type in ('payroll','registration','invoice','other')),
  related_record_id uuid,
  direction text not null check (direction in ('debit','credit','fee','refund','reversal')),
  status text not null check (status in ('created','pending','processing','succeeded','failed','returned','cancelled')),
  amount_cents bigint not null check (amount_cents >= 0),
  currency text not null default 'usd' check (currency = lower(currency) and length(currency) = 3),
  stripe_object_type text,
  stripe_object_id text,
  idempotency_key text unique,
  failure_code text,
  failure_message text,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create unique index if not exists payment_transactions_stripe_object_idx
  on public.payment_transactions(stripe_object_type, stripe_object_id)
  where stripe_object_id is not null;

create table if not exists public.payroll_transfers (
  id uuid primary key default gen_random_uuid(),
  payroll_batch_id uuid not null references public.payroll_batches(id) on delete restrict,
  payroll_batch_item_id uuid not null references public.payroll_batch_items(id) on delete restrict,
  official_id uuid not null references public.officials(id) on delete restrict,
  stripe_account_id_snapshot text not null,
  stripe_transfer_id text unique,
  stripe_payout_id text,
  amount_cents bigint not null check (amount_cents > 0),
  currency text not null default 'usd' check (currency = lower(currency) and length(currency) = 3),
  status text not null default 'pending' check (status in ('pending','processing','paid','failed','reversed')),
  idempotency_key text unique not null,
  failure_code text,
  failure_message text,
  transferred_at timestamptz,
  paid_at timestamptz,
  reversed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (payroll_batch_item_id)
);

create table if not exists public.payment_audit_events (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete restrict,
  league_id uuid references public.leagues(id) on delete restrict,
  payroll_batch_id uuid references public.payroll_batches(id) on delete restrict,
  entity_type text not null,
  entity_id uuid,
  event_type text not null,
  actor_user_id uuid references auth.users(id) on delete set null,
  old_values jsonb,
  new_values jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists league_payment_settings_scope_idx on public.league_payment_settings(organization_id, league_id);
create index if not exists payroll_batches_scope_idx on public.payroll_batches(organization_id, league_id, created_at desc);
create index if not exists payroll_batches_status_idx on public.payroll_batches(status, created_at);
create index if not exists payroll_batch_items_batch_idx on public.payroll_batch_items(payroll_batch_id);
create index if not exists payroll_batch_items_official_idx on public.payroll_batch_items(official_id);
create index if not exists payment_transactions_scope_idx on public.payment_transactions(organization_id, league_id, occurred_at desc);
create index if not exists payroll_transfers_batch_idx on public.payroll_transfers(payroll_batch_id, status);
create index if not exists payroll_transfers_official_idx on public.payroll_transfers(official_id, paid_at desc);
create index if not exists payment_audit_events_scope_idx on public.payment_audit_events(organization_id, created_at desc);

create or replace function private.prevent_locked_payroll_item_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_batch_status text;
begin
  if tg_op = 'DELETE' then
    select status into v_batch_status
    from public.payroll_batches
    where id = old.payroll_batch_id;
  else
    select status into v_batch_status
    from public.payroll_batches
    where id = new.payroll_batch_id;
  end if;

  if v_batch_status is distinct from 'draft' then
    raise exception 'Locked payroll batch items cannot be changed.' using errcode = '55000';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists protect_locked_payroll_items on public.payroll_batch_items;
create trigger protect_locked_payroll_items
before update or delete on public.payroll_batch_items
for each row execute function private.prevent_locked_payroll_item_mutation();

create or replace function private.protect_locked_payroll_batch_values()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if old.status <> 'draft' and (
    new.organization_id is distinct from old.organization_id
    or new.league_id is distinct from old.league_id
    or new.currency is distinct from old.currency
    or new.payroll_subtotal_cents is distinct from old.payroll_subtotal_cents
    or new.stripe_processing_cost_cents is distinct from old.stripe_processing_cost_cents
    or new.refassign_fee_cents is distinct from old.refassign_fee_cents
    or new.total_funding_cents is distinct from old.total_funding_cents
    or new.fee_type_snapshot is distinct from old.fee_type_snapshot
    or new.fee_value_snapshot is distinct from old.fee_value_snapshot
    or new.fee_minimum_cents_snapshot is distinct from old.fee_minimum_cents_snapshot
    or new.fee_maximum_cents_snapshot is distinct from old.fee_maximum_cents_snapshot
    or new.funding_method is distinct from old.funding_method
    or new.idempotency_key is distinct from old.idempotency_key
    or new.locked_at is distinct from old.locked_at
  ) then
    raise exception 'Locked payroll batch financial values cannot be changed.' using errcode = '55000';
  end if;
  return new;
end;
$$;

drop trigger if exists protect_locked_payroll_batch_values on public.payroll_batches;
create trigger protect_locked_payroll_batch_values
before update on public.payroll_batches
for each row execute function private.protect_locked_payroll_batch_values();

create or replace view public.official_annual_league_compensation
with (security_invoker = true)
as
select
  batch.organization_id,
  batch.league_id,
  transfer.official_id,
  extract(year from transfer.paid_at)::integer as tax_year,
  sum(transfer.amount_cents)::bigint as compensation_cents,
  count(*)::bigint as payment_count
from public.payroll_transfers transfer
join public.payroll_batches batch on batch.id = transfer.payroll_batch_id
where transfer.status = 'paid' and transfer.paid_at is not null
group by batch.organization_id, batch.league_id, transfer.official_id,
  extract(year from transfer.paid_at)::integer;

alter table public.transaction_fee_rules enable row level security;
alter table public.league_payment_settings enable row level security;
alter table public.official_stripe_accounts enable row level security;
alter table public.payroll_batches enable row level security;
alter table public.payroll_batch_items enable row level security;
alter table public.payment_transactions enable row level security;
alter table public.payroll_transfers enable row level security;
alter table public.payment_audit_events enable row level security;

revoke all on public.transaction_fee_rules, public.league_payment_settings,
  public.official_stripe_accounts, public.payroll_batches, public.payroll_batch_items,
  public.payment_transactions, public.payroll_transfers, public.payment_audit_events
  from public, anon, authenticated;
grant select on public.transaction_fee_rules, public.league_payment_settings,
  public.official_stripe_accounts, public.payroll_batches, public.payroll_batch_items,
  public.payment_transactions, public.payroll_transfers, public.payment_audit_events,
  public.official_annual_league_compensation to authenticated;
grant all on public.transaction_fee_rules, public.league_payment_settings,
  public.official_stripe_accounts, public.payroll_batches, public.payroll_batch_items,
  public.payment_transactions, public.payroll_transfers, public.payment_audit_events to service_role;

create policy "Members view transaction fee rules" on public.transaction_fee_rules
for select to authenticated using (private.can_access_organization(organization_id));
create policy "Super admins manage transaction fee rules" on public.transaction_fee_rules
for all to authenticated using ((select public.is_super_admin()))
with check ((select public.is_super_admin()));

create policy "Members view league payment settings" on public.league_payment_settings
for select to authenticated using (private.can_access_organization(organization_id));
create policy "Super admins manage league payment settings" on public.league_payment_settings
for all to authenticated using ((select public.is_super_admin()))
with check ((select public.is_super_admin()));

create policy "Officials view own Stripe account" on public.official_stripe_accounts
for select to authenticated using (
  (select public.is_super_admin()) or exists (
    select 1 from public.officials official
    where official.id = official_stripe_accounts.official_id
      and official.auth_user_id = (select auth.uid())
  )
);

create policy "Members view payroll batches" on public.payroll_batches
for select to authenticated using (private.can_access_organization(organization_id));

create policy "Members view payroll batch items" on public.payroll_batch_items
for select to authenticated using (
  exists (
    select 1 from public.payroll_batches batch
    where batch.id = payroll_batch_items.payroll_batch_id
      and private.can_access_organization(batch.organization_id)
  ) or exists (
    select 1 from public.officials official
    where official.id = payroll_batch_items.official_id
      and official.auth_user_id = (select auth.uid())
  )
);

create policy "Members view payment transactions" on public.payment_transactions
for select to authenticated using (private.can_access_organization(organization_id));

create policy "Members view payroll transfers" on public.payroll_transfers
for select to authenticated using (
  exists (
    select 1 from public.payroll_batches batch
    where batch.id = payroll_transfers.payroll_batch_id
      and private.can_access_organization(batch.organization_id)
  ) or exists (
    select 1 from public.officials official
    where official.id = payroll_transfers.official_id
      and official.auth_user_id = (select auth.uid())
  )
);

create policy "Members view payment audit events" on public.payment_audit_events
for select to authenticated using (private.can_access_organization(organization_id));

comment on table public.payroll_batches is 'Immutable-after-approval payroll batch headers; Stripe movement is implemented in later phases.';
comment on table public.payroll_batch_items is 'Snapshot of assignment compensation at payroll approval time.';
comment on table public.payment_transactions is 'Provider-neutral ledger of funding, fees, refunds, and reversals.';
comment on table public.payment_audit_events is 'Append-only payment and payroll audit trail.';
