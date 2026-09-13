create index if not exists undo_operations_expires_idx
  on public.undo_operations (expires_at);

create index if not exists undo_operations_undone_idx
  on public.undo_operations (undone_at)
  where undone_at is not null;

create or replace function public.cleanup_expired_undo_operations()
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_deleted integer;
begin
  delete from public.undo_operations
  where undone_at is not null
     or expires_at < now();
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke all on function public.cleanup_expired_undo_operations()
  from public, anon, authenticated;
grant execute on function public.cleanup_expired_undo_operations()
  to service_role;
