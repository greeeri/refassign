-- Preserve the funding party on every payroll batch so Stripe funding,
-- transfers, reporting, refunds, and disputes reconcile to the selected Bill To.
alter table public.payroll_batches add column if not exists bill_to_id uuid;
alter table public.payroll_batches drop constraint if exists payroll_batches_organization_bill_to_fkey;
alter table public.payroll_batches add constraint payroll_batches_organization_bill_to_fkey
  foreign key (organization_id, bill_to_id)
  references public.bill_to_accounts(organization_id, id) on delete restrict;
create index if not exists payroll_batches_bill_to_idx
  on public.payroll_batches(organization_id, bill_to_id, created_at desc);
comment on column public.payroll_batches.bill_to_id is
  'Billing party that funded this Stripe payroll batch. New Stripe batches require this in application validation.';
