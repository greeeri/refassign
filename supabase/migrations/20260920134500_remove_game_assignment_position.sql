create or replace function public.remove_game_assignment_position(
  p_game_id uuid,
  p_position_id uuid
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_game public.games%rowtype;
  v_position_ordinal integer;
  v_removed_assignments integer := 0;
begin
  if not private.can_manage_game(p_game_id) then
    raise exception 'Only an Administrator or Assignor can remove a position.' using errcode = '42501';
  end if;

  select * into v_game
  from public.games
  where id = p_game_id
  for update;

  if v_game.id is null then
    raise exception 'Game not found.';
  end if;

  if exists(
    select 1
    from public.game_mentor_slots
    where game_id = p_game_id and position_id = p_position_id
  ) then
    delete from public.assignments
    where game_id = p_game_id and position_id = p_position_id;
    get diagnostics v_removed_assignments = row_count;

    delete from public.game_mentor_slots
    where game_id = p_game_id and position_id = p_position_id;

    delete from public.assignment_self_assign_slots
    where game_id = p_game_id and position_id = p_position_id;

    return v_removed_assignments;
  end if;

  select ordered.ordinal into v_position_ordinal
  from (
    select position.id,
           row_number() over(order by position.sort_order, position.id)::integer as ordinal
    from public.sport_positions position
    where position.sport_id = v_game.sport_id
  ) ordered
  where ordered.id = p_position_id;

  if v_position_ordinal is null or v_position_ordinal > v_game.officials_needed then
    raise exception 'That position is not active on this game.';
  end if;

  if v_position_ordinal <> v_game.officials_needed then
    raise exception 'Remove the last standard position first so the crew order remains valid.';
  end if;

  if v_game.officials_needed <= 1 then
    raise exception 'A game must keep at least one standard official position.';
  end if;

  delete from public.assignments
  where game_id = p_game_id and position_id = p_position_id;
  get diagnostics v_removed_assignments = row_count;

  delete from public.assignment_self_assign_slots
  where game_id = p_game_id and position_id = p_position_id;

  update public.games
  set officials_needed = officials_needed - 1
  where id = p_game_id;

  return v_removed_assignments;
end;
$$;

revoke all on function public.remove_game_assignment_position(uuid, uuid) from public, anon;
grant execute on function public.remove_game_assignment_position(uuid, uuid) to authenticated;
