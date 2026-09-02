alter table public.undo_changes
  drop constraint if exists undo_changes_table_name_check;

alter table public.undo_changes
  add constraint undo_changes_table_name_check
  check (
    table_name in (
      'games',
      'assignments',
      'assignment_self_assign_slots',
      'official_availability_blocks'
    )
  );

drop trigger if exists undo_capture_official_availability_blocks
  on public.official_availability_blocks;

create trigger undo_capture_official_availability_blocks
after insert or update or delete on public.official_availability_blocks
for each row execute function public.capture_undo_change();

create or replace function public.label_overdue_assignment_undo()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if exists (
    select 1
    from public.undo_operations operation
    join public.undo_changes change on change.operation_id = operation.id
    where operation.transaction_id = txid_current()
      and operation.actor_user_id = auth.uid()
      and change.table_name = 'official_availability_blocks'
      and change.operation = 'INSERT'
  ) then
    update public.undo_operations
    set description = 'Remove overdue assignments + create blocks'
    where transaction_id = txid_current()
      and actor_user_id = auth.uid();
  end if;

  return old;
end;
$$;

revoke all on function public.label_overdue_assignment_undo()
  from public, anon, authenticated;

drop trigger if exists undo_label_overdue_assignment_removal
  on public.assignments;

create trigger undo_label_overdue_assignment_removal
after delete on public.assignments
for each row execute function public.label_overdue_assignment_undo();
