-- Approved positive fee corrections can be funded as separate payroll items.
alter table public.payroll_fee_corrections
  add column if not exists paid_at timestamptz;
alter table public.payroll_batch_items
  alter column assignment_id drop not null;
alter table public.payroll_batch_items
  add column if not exists fee_correction_id uuid references public.payroll_fee_corrections(id) on delete restrict;
create unique index if not exists payroll_batch_items_fee_correction_unique
  on public.payroll_batch_items(fee_correction_id) where fee_correction_id is not null;
alter table public.payroll_batch_items
  add constraint payroll_batch_item_one_source check
    ((assignment_id is not null and fee_correction_id is null)
      or (assignment_id is null and fee_correction_id is not null));
