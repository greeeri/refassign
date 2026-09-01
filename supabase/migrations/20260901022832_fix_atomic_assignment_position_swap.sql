create or replace function public.move_assignment_position(
  p_game_id uuid,p_assignment_id uuid,p_direction integer
) returns void language plpgsql security invoker set search_path='public' as $$
declare v_source record; v_target_position uuid; v_target_assignment uuid;
begin
  if not public.can_manage_game_setup() then raise exception 'Only Administrators and Assignors can manage assignments'; end if;
  if p_direction not in (-1,1) then raise exception 'Direction must be -1 or 1'; end if;
  select a.position_id,g.sport_id,g.officials_needed,
    (select count(*) from public.sport_positions preceding where preceding.sport_id=g.sport_id
      and (preceding.sort_order<sp.sort_order or (preceding.sort_order=sp.sort_order and preceding.id<sp.id)))::integer as slot
    into v_source from public.assignments a join public.games g on g.id=a.game_id
    join public.sport_positions sp on sp.id=a.position_id
    where a.id=p_assignment_id and a.game_id=p_game_id for update of a;
  if not found then raise exception 'Assignment not found'; end if;
  select positions.id into v_target_position from (
    select sp.id,row_number() over(order by sp.sort_order,sp.id)-1 as slot
    from public.sport_positions sp where sp.sport_id=v_source.sport_id
    order by sp.sort_order,sp.id limit greatest(v_source.officials_needed,0)
  ) positions where positions.slot=v_source.slot+p_direction;
  if v_target_position is null then raise exception 'There is no position in that direction'; end if;
  select id into v_target_assignment from public.assignments where game_id=p_game_id
    and position_id=v_target_position and status<>'declined' order by assigned_at desc limit 1 for update;
  if v_target_assignment is not null then
    update public.assignments set position_id=null where id=v_target_assignment;
  end if;
  update public.assignments set position_id=v_target_position where id=p_assignment_id;
  if v_target_assignment is not null then
    update public.assignments set position_id=v_source.position_id where id=v_target_assignment;
  end if;
end; $$;
