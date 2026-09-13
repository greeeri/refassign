create index if not exists audit_history_occurred_at_idx
  on public.audit_history (occurred_at);

create or replace function public.cleanup_expired_operational_history()
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_undo_deleted integer;
  v_audit_deleted integer;
begin
  delete from public.undo_operations
  where undone_at is not null
     or expires_at < now();
  get diagnostics v_undo_deleted = row_count;

  delete from public.audit_history
  where occurred_at < now() - interval '3 years';
  get diagnostics v_audit_deleted = row_count;

  return jsonb_build_object(
    'undo_deleted', v_undo_deleted,
    'audit_deleted', v_audit_deleted,
    'audit_retention_years', 3
  );
end;
$$;

revoke all on function public.cleanup_expired_operational_history()
  from public, anon, authenticated;
grant execute on function public.cleanup_expired_operational_history()
  to service_role;

drop function if exists public.cleanup_expired_undo_operations();
