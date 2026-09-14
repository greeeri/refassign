alter table public.payroll_batches
  add column if not exists stripe_checkout_session_id text unique,
  add column if not exists stripe_processing_cost_actual_cents bigint
    check (stripe_processing_cost_actual_cents is null or stripe_processing_cost_actual_cents >= 0),
  add column if not exists funding_failure_message text;

comment on column public.payroll_batches.stripe_processing_cost_cents is
  'Estimated Stripe processing cost collected from the league at checkout.';
comment on column public.payroll_batches.stripe_processing_cost_actual_cents is
  'Actual Stripe fee reported by the charge balance transaction when available.';
