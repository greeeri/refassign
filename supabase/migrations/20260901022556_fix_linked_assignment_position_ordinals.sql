create or replace function public.assign_official_to_linked_games(
  p_game_id uuid, p_position_id uuid, p_official_id uuid
) returns integer language plpgsql security invoker set search_path='public' as $$
declare v_group_id uuid; v_source_slot integer; v_target_position uuid;
  v_existing_position uuid; v_existing_assignment uuid;
  v_official_assignment uuid; v_count integer:=0; v_game record;
begin
  if not public.can_manage_game_setup() then raise exception 'Only Administrators and Assignors can manage assignments'; end if;
  if p_official_id is null then raise exception 'An official is required'; end if;
  select ranked.slot into v_source_slot from (
    select sp.id,row_number() over(order by sp.sort_order,sp.id)-1 as slot
    from public.sport_positions sp where sp.sport_id=(select sport_id from public.sport_positions where id=p_position_id)
  ) ranked where ranked.id=p_position_id;
  if v_source_slot is null then raise exception 'Assignment position not found'; end if;
  select group_id into v_group_id from public.game_link_members where game_id=p_game_id;
  for v_game in select g.id,g.sport_id,g.officials_needed from public.games g
    where g.id=p_game_id or (v_group_id is not null and g.id in
      (select game_id from public.game_link_members where group_id=v_group_id))
    order by g.starts_at,g.id
  loop
    select id into v_target_position from public.sport_positions where sport_id=v_game.sport_id
      order by sort_order,id offset v_source_slot limit 1;
    if v_target_position is null or v_source_slot>=greatest(v_game.officials_needed,0) then
      raise exception 'A linked game does not have the matching assignment position';
    end if;
    select id,position_id into v_official_assignment,v_existing_position from public.assignments
      where game_id=v_game.id and official_id=p_official_id for update;
    select id into v_existing_assignment from public.assignments
      where game_id=v_game.id and position_id=v_target_position and status<>'declined'
      order by assigned_at desc limit 1 for update;
    if v_official_assignment is not null and v_existing_position is distinct from v_target_position then
      raise exception 'The official is already assigned to a different position on a linked game';
    end if;
    if v_existing_assignment is not null then
      update public.assignments set official_id=p_official_id,status='proposed',published_at=null,
        accept_by=null,published_by=null,email_sent_at=null,resend_email_id=null,email_error=null,
        response_token=null,responded_at=null,decline_reason=null where id=v_existing_assignment;
    elsif v_official_assignment is null then
      insert into public.assignments(game_id,official_id,position_id,status)
      values(v_game.id,p_official_id,v_target_position,'proposed');
    end if;
    v_count:=v_count+1; v_target_position:=null; v_existing_position:=null;
    v_existing_assignment:=null; v_official_assignment:=null;
  end loop;
  return v_count;
end; $$;

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
  update public.assignments set position_id=v_target_position where id=p_assignment_id;
  if v_target_assignment is not null then
    update public.assignments set position_id=v_source.position_id where id=v_target_assignment;
  end if;
end; $$;
