create or replace function public.import_assignment_game_fees(
  p_organization_id uuid,
  p_rows jsonb
)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_row jsonb;
  v_count integer := 0;
  v_assignment_id uuid;
  v_game_id uuid;
  v_sheet_row integer;
  v_game_fee numeric(10,2);
begin
  if auth.uid() is null or not private.can_manage_organization(p_organization_id) then
    raise exception 'You cannot import assignment fees for this organization.' using errcode = '42501';
  end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception 'The assignment fee import contains no rows.';
  end if;

  for v_row in select value from jsonb_array_elements(p_rows)
  loop
    v_sheet_row := coalesce((v_row->>'spreadsheet_row')::integer, v_count + 2);
    begin
      v_assignment_id := (v_row->>'assignment_id')::uuid;
      v_game_id := nullif(v_row->>'game_id', '')::uuid;
      v_game_fee := (v_row->>'game_fee')::numeric;
    exception when others then
      raise exception 'Spreadsheet row %: Assignment ID, Game ID, or Game Fee is invalid.', v_sheet_row;
    end;
    if v_game_fee < 0 then
      raise exception 'Spreadsheet row %: Game Fee must be zero or greater.', v_sheet_row;
    end if;

    update public.assignments a
    set game_fee = v_game_fee,
        payroll_updated_at = now(),
        payroll_updated_by = auth.uid()
    where a.id = v_assignment_id
      and (v_game_id is null or a.game_id = v_game_id)
      and a.status not in ('declined', 'cancelled', 'canceled')
      and a.payment_status <> 'paid'
      and exists (
        select 1 from public.games g
        where g.id = a.game_id and g.organization_id = p_organization_id
      );
    if not found then
      raise exception 'Spreadsheet row %: the assignment is unavailable, inactive, mismatched, or already paid.', v_sheet_row;
    end if;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

revoke all on function public.import_assignment_game_fees(uuid,jsonb) from public, anon;
grant execute on function public.import_assignment_game_fees(uuid,jsonb) to authenticated;

comment on function public.import_assignment_game_fees(uuid,jsonb) is
  'Atomically imports game fees from the Assignment Center export into assignment payroll records.';
