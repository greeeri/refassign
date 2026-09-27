-- Preserve paid payroll while recording proposed fee corrections for review.
create table if not exists public.payroll_fee_corrections (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  assignment_id uuid not null references public.assignments(id) on delete restrict,
  paid_game_fee numeric(10,2) not null check (paid_game_fee >= 0),
  proposed_game_fee numeric(10,2) not null check (proposed_game_fee >= 0),
  difference numeric(10,2) generated always as (proposed_game_fee - paid_game_fee) stored,
  status text not null default 'pending' check (status in ('pending','approved','void')),
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (assignment_id, proposed_game_fee)
);
create unique index if not exists payroll_fee_corrections_one_pending
  on public.payroll_fee_corrections (assignment_id) where status = 'pending';
create index if not exists payroll_fee_corrections_org_status
  on public.payroll_fee_corrections (organization_id,status,created_at desc);
alter table public.payroll_fee_corrections enable row level security;
revoke all on public.payroll_fee_corrections from public, anon, authenticated;
grant select, insert, update on public.payroll_fee_corrections to service_role;

create or replace function public.import_game_position_pay(p_organization_id uuid, p_rows jsonb)
returns integer language plpgsql security invoker set search_path = '' as $$
declare
  v_row jsonb;
  v_game uuid;
  v_position uuid;
  v_amount numeric(10,2);
  v_count integer := 0;
  v_paid public.assignments%rowtype;
begin
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) not between 1 and 5000 then
    raise exception 'The import must contain between 1 and 5,000 rows.';
  end if;
  for v_row in select value from jsonb_array_elements(p_rows) loop
    v_game := (v_row->>'game_id')::uuid;
    v_position := (v_row->>'position_id')::uuid;
    v_amount := (v_row->>'amount')::numeric;
    if v_amount is null or v_amount < 0 or v_amount > 99999999.99 or not exists (
      select 1 from public.games g where g.id = v_game and g.organization_id = p_organization_id
        and v_position in (select id from public.sport_positions where sport_id = g.sport_id order by sort_order, id limit g.officials_needed)
    ) then
      raise exception 'Spreadsheet row %: invalid game position or amount.', v_row->>'spreadsheet_row';
    end if;
    select a.* into v_paid from public.assignments a where a.game_id = v_game and a.position_id = v_position
      and a.payment_status = 'paid' and a.status in ('proposed','accepted','confirmed') limit 1;
    if found then
      if v_amount is distinct from v_paid.game_fee then
        -- A new target supersedes an earlier pending suggestion, without changing paid history.
        update public.payroll_fee_corrections set status = 'void', reviewed_at = now()
          where assignment_id = v_paid.id and status = 'pending' and proposed_game_fee <> v_amount;
        insert into public.payroll_fee_corrections
          (organization_id,assignment_id,paid_game_fee,proposed_game_fee)
          values (p_organization_id,v_paid.id,v_paid.game_fee,v_amount)
          on conflict (assignment_id,proposed_game_fee) do nothing;
      end if;
      continue;
    end if;
    if exists (select 1 from public.assignments a where a.game_id = v_game and a.position_id = v_position
      and a.payment_status = 'approved' and a.status in ('proposed','accepted','confirmed')) then
      raise exception 'Spreadsheet row %: approved payroll cannot be changed.', v_row->>'spreadsheet_row';
    end if;
    insert into public.game_position_pay (game_id, position_id, amount)
      values (v_game, v_position, v_amount)
      on conflict (game_id, position_id) do update set amount = excluded.amount;
    update public.assignments set game_fee = v_amount
      where game_id = v_game and position_id = v_position
        and payment_status = 'unpaid' and status in ('proposed', 'accepted', 'confirmed');
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;
revoke all on function public.import_game_position_pay(uuid,jsonb) from public, anon, authenticated;
grant execute on function public.import_game_position_pay(uuid,jsonb) to service_role;
