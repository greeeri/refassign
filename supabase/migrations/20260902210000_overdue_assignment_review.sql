alter table public.assignments
  add column if not exists overdue_reviewed_at timestamptz,
  add column if not exists overdue_reviewed_by uuid references auth.users(id) on delete set null,
  add column if not exists overdue_review_action text;

alter table public.assignments
  drop constraint if exists assignments_overdue_review_action_check;

alter table public.assignments
  add constraint assignments_overdue_review_action_check
  check (overdue_review_action is null or overdue_review_action in ('kept'));

create or replace function public.resolve_overdue_assignments(
  p_assignment_ids uuid[],
  p_action text
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_assignment record;
  v_count integer := 0;
  v_blocks integer := 0;
begin
  if not exists (
    select 1 from public.profiles
    where id = (select auth.uid())
      and role in ('admin', 'assignor')
      and active = true
  ) then
    raise exception 'Only an active admin or assignor can review overdue assignments.';
  end if;

  if p_action not in ('keep', 'remove', 'remove_and_block') then
    raise exception 'Choose keep, remove, or remove and block.';
  end if;

  for v_assignment in
    select a.id, a.official_id, g.starts_at, g.duration_minutes
    from public.assignments a
    join public.games g on g.id = a.game_id
    where a.id = any(p_assignment_ids)
      and a.status = 'proposed'
      and a.published_at is not null
      and a.accept_by < now()
      and a.overdue_reviewed_at is null
      and g.starts_at > now()
      and g.status not in ('canceled', 'rained_out')
    for update of a
  loop
    if p_action = 'keep' then
      update public.assignments
      set overdue_reviewed_at = now(),
          overdue_reviewed_by = (select auth.uid()),
          overdue_review_action = 'kept'
      where id = v_assignment.id;
    else
      if p_action = 'remove_and_block' and not exists (
        select 1 from public.official_availability_blocks b
        where b.official_id = v_assignment.official_id
          and b.block_type = 'time'
          and b.starts_at = v_assignment.starts_at
          and b.ends_at = v_assignment.starts_at + make_interval(mins => coalesce(v_assignment.duration_minutes, 110))
      ) then
        insert into public.official_availability_blocks (
          official_id, block_type, starts_at, ends_at, notes, created_by
        ) values (
          v_assignment.official_id,
          'time',
          v_assignment.starts_at,
          v_assignment.starts_at + make_interval(mins => coalesce(v_assignment.duration_minutes, 110)),
          'Created by assignor after missed assignment acceptance deadline',
          (select auth.uid())
        );
        v_blocks := v_blocks + 1;
      end if;

      delete from public.assignments where id = v_assignment.id;
    end if;
    v_count := v_count + 1;
  end loop;

  if v_count = 0 then
    raise exception 'These assignments are no longer overdue or have already been reviewed.';
  end if;

  return jsonb_build_object('assignments_resolved', v_count, 'blocks_created', v_blocks);
end;
$$;

revoke all on function public.resolve_overdue_assignments(uuid[], text) from public, anon;
grant execute on function public.resolve_overdue_assignments(uuid[], text) to authenticated;
