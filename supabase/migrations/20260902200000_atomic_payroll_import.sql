create or replace function public.import_payroll_rows(p_rows jsonb)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_row jsonb;
  v_count integer := 0;
  v_assignment_id uuid;
  v_sheet_row integer;
  v_payment_status text;
begin
  if not exists (
    select 1 from public.profiles
    where id = (select auth.uid())
      and role in ('admin', 'assignor')
      and active = true
  ) then
    raise exception 'Only an active admin or assignor can import payroll.';
  end if;

  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception 'The payroll import contains no rows.';
  end if;

  for v_row in select value from jsonb_array_elements(p_rows)
  loop
    v_sheet_row := coalesce((v_row->>'spreadsheet_row')::integer, v_count + 2);
    begin
      v_assignment_id := (v_row->>'assignment_id')::uuid;
    exception when others then
      raise exception 'Spreadsheet row %: Assignment ID is invalid.', v_sheet_row;
    end;
    v_payment_status := lower(coalesce(v_row->>'payment_status', ''));

    if v_payment_status not in ('unpaid', 'approved', 'paid', 'void') then
      raise exception 'Spreadsheet row %: Payment Status is invalid.', v_sheet_row;
    end if;
    if (v_row->>'game_fee')::numeric < 0
      or (v_row->>'mileage_miles')::numeric < 0
      or (v_row->>'mileage_rate')::numeric < 0 then
      raise exception 'Spreadsheet row %: payroll amounts cannot be negative.', v_sheet_row;
    end if;

    update public.assignments
    set game_fee = (v_row->>'game_fee')::numeric,
        mileage_miles = (v_row->>'mileage_miles')::numeric,
        mileage_rate = (v_row->>'mileage_rate')::numeric,
        payment_status = v_payment_status,
        paid_at = case when v_payment_status = 'paid' then coalesce(paid_at, now()) else null end,
        payroll_notes = nullif(trim(v_row->>'payroll_notes'), ''),
        payroll_updated_at = now(),
        payroll_updated_by = (select auth.uid())
    where id = v_assignment_id
      and status in ('accepted', 'confirmed');

    if not found then
      raise exception 'Spreadsheet row %: accepted assignment was not found.', v_sheet_row;
    end if;
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

revoke all on function public.import_payroll_rows(jsonb) from public, anon;
grant execute on function public.import_payroll_rows(jsonb) to authenticated;
