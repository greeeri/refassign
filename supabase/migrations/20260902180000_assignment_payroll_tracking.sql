alter table public.assignments
  add column if not exists game_fee numeric(10,2) not null default 0 check (game_fee >= 0),
  add column if not exists mileage_miles numeric(8,2) not null default 0 check (mileage_miles >= 0),
  add column if not exists mileage_rate numeric(6,3) not null default 0 check (mileage_rate >= 0),
  add column if not exists payment_status text not null default 'unpaid',
  add column if not exists paid_at timestamptz,
  add column if not exists payroll_notes text,
  add column if not exists payroll_updated_at timestamptz,
  add column if not exists payroll_updated_by uuid references auth.users(id) on delete set null;

alter table public.assignments
  drop constraint if exists assignments_payment_status_check;

alter table public.assignments
  add constraint assignments_payment_status_check
  check (payment_status in ('unpaid','approved','paid','void'));

create index if not exists assignments_payment_status_idx
  on public.assignments (payment_status, paid_at);
