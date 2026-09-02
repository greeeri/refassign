alter table public.assignments
  drop constraint if exists assignments_assignment_source_check;

alter table public.assignments
  add constraint assignments_assignment_source_check
  check (assignment_source in ('manager', 'self_assign', 'auto_assign'));

create or replace function public.mark_auto_assign_source()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if current_setting('refassign.auto_assign', true) = 'on' then
    new.assignment_source := 'auto_assign';
  end if;
  return new;
end;
$$;

drop trigger if exists mark_auto_assign_source_trigger on public.assignments;
create trigger mark_auto_assign_source_trigger
before insert on public.assignments
for each row execute function public.mark_auto_assign_source();

do $$
begin
  if to_regprocedure('public.run_auto_assign_core(date,date)') is null
     and to_regprocedure('public.run_auto_assign(date,date)') is not null then
    alter function public.run_auto_assign(date, date) rename to run_auto_assign_core;
  end if;
end;
$$;

create or replace function public.run_auto_assign(p_start_date date, p_end_date date)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  if not exists (
    select 1 from public.profiles
    where id = (select auth.uid())
      and role in ('admin', 'assignor')
      and active = true
  ) then
    raise exception 'Only an active Administrator or Assignor can run AutoAssign.';
  end if;

  perform set_config('refassign.auto_assign', 'on', true);
  v_result := public.run_auto_assign_core(p_start_date, p_end_date);
  perform set_config('refassign.auto_assign', 'off', true);
  return v_result;
end;
$$;

revoke all on function public.run_auto_assign_core(date, date) from public, anon, authenticated;
revoke all on function public.run_auto_assign(date, date) from public, anon;
grant execute on function public.run_auto_assign(date, date) to authenticated;
revoke all on function public.mark_auto_assign_source() from public, anon, authenticated;
