create or replace function public.import_game_position_pay(p_organization_id uuid, p_rows jsonb)
returns integer language plpgsql security invoker set search_path = '' as $$
declare
  v_row jsonb;
  v_game uuid;
  v_position uuid;
  v_amount numeric(10,2);
  v_count integer := 0;
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
    if exists (select 1 from public.assignments a where a.game_id = v_game and a.position_id = v_position
      and a.payment_status in ('paid', 'approved') and a.status in ('proposed', 'accepted', 'confirmed')) then
      raise exception 'Spreadsheet row %: approved or paid payroll cannot be changed.', v_row->>'spreadsheet_row';
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
