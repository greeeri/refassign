alter table public.refassign_subscriptions
  add column if not exists reporting_access text not null default 'premium'
    check (reporting_access in ('standard', 'premium')),
  add column if not exists premium_reporting_amount_cents integer
    check (premium_reporting_amount_cents is null or premium_reporting_amount_cents >= 0),
  add column if not exists premium_reporting_billing_interval text not null default 'annual'
    check (premium_reporting_billing_interval in ('monthly', 'annual')),
  add column if not exists reporting_override_reason text,
  add column if not exists reporting_access_updated_at timestamptz,
  add column if not exists reporting_access_updated_by uuid references auth.users(id) on delete set null;

comment on column public.refassign_subscriptions.reporting_access is
  'Controls whether the account receives standard activity reporting or premium financial reporting.';
comment on column public.refassign_subscriptions.premium_reporting_amount_cents is
  'Account-specific premium reporting charge. Null means the feature is included in the base subscription.';
