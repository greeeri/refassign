-- Payroll edits (including spreadsheet imports) must update the game's quoted
-- position fee so a later Games export reflects the same amount.
create or replace function private.sync_assignment_fee_to_position_pay()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status in ('accepted', 'confirmed')
    and old.payment_status <> 'paid'
    and new.game_fee is distinct from old.game_fee then
    insert into public.game_position_pay (game_id, position_id, amount)
      values (new.game_id, new.position_id, new.game_fee)
      on conflict (game_id, position_id) do update set amount = excluded.amount;
  end if;
  return new;
end;
$$;
revoke all on function private.sync_assignment_fee_to_position_pay() from public, anon, authenticated;

drop trigger if exists sync_assignment_fee_to_position_pay on public.assignments;
create trigger sync_assignment_fee_to_position_pay
after update of game_fee on public.assignments
for each row execute function private.sync_assignment_fee_to_position_pay();
