-- Replacing an official reuses the assignment ID. Preserve game pay without
-- carrying the old official's payment state or mileage to the new payee.
create or replace function private.protect_assignment_payee_update()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.official_id is not distinct from old.official_id then return new; end if;
  if old.payment_status in ('approved', 'paid') or exists (
    select 1 from public.payroll_batch_items where assignment_id = old.id
  ) then
    raise exception 'This assignment has approved or processed payroll. Correct payroll before changing the official.' using errcode = '55000';
  end if;
  insert into public.game_position_pay (game_id, position_id, amount, payment_status)
    values (old.game_id, old.position_id, old.game_fee, 'unpaid')
    on conflict (game_id, position_id) do update
      set amount = excluded.amount, payment_status = 'unpaid';
  new.payment_status := 'unpaid';
  new.paid_at := null;
  new.mileage_miles := 0;
  new.mileage_rate := 0;
  new.payroll_notes := null;
  new.payroll_updated_at := now();
  new.payroll_updated_by := auth.uid();
  return new;
end;
$$;
revoke all on function private.protect_assignment_payee_update() from public, anon, authenticated;

create or replace function private.protect_assignment_payee_delete()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.payment_status in ('approved', 'paid') or exists (
    select 1 from public.payroll_batch_items where assignment_id = old.id
  ) then
    raise exception 'This assignment has approved or processed payroll. Correct payroll before removing the official.' using errcode = '55000';
  end if;
  insert into public.game_position_pay (game_id, position_id, amount, payment_status)
    values (old.game_id, old.position_id, old.game_fee, 'unpaid')
    on conflict (game_id, position_id) do update
      set amount = excluded.amount, payment_status = 'unpaid';
  return old;
end;
$$;
revoke all on function private.protect_assignment_payee_delete() from public, anon, authenticated;

drop trigger if exists protect_assignment_payee_update on public.assignments;
create trigger protect_assignment_payee_update
before update of official_id on public.assignments
for each row execute function private.protect_assignment_payee_update();
drop trigger if exists protect_assignment_payee_delete on public.assignments;
create trigger protect_assignment_payee_delete
before delete on public.assignments
for each row execute function private.protect_assignment_payee_delete();
