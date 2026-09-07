create or replace function public.prevent_inactive_game_assignment()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_game_status text;
begin
  select lower(coalesce(status, ''))
    into v_game_status
  from public.games
  where id = new.game_id;

  if v_game_status in ('suspended', 'hold', 'on_hold', 'rained_out', 'rain_out', 'canceled', 'cancelled')
     and lower(coalesce(new.status, '')) not in ('canceled', 'cancelled') then
    if current_setting('refassign.auto_assign', true) = 'on' then
      return null;
    end if;
    raise exception 'Assignments cannot be added to On Hold, Rain Out, or Cancelled games.';
  end if;

  return new;
end;
$$;

drop trigger if exists prevent_inactive_game_assignment_trigger on public.assignments;
create trigger prevent_inactive_game_assignment_trigger
before insert or update of game_id, official_id, position_id, status on public.assignments
for each row execute function public.prevent_inactive_game_assignment();

revoke all on function public.prevent_inactive_game_assignment() from public, anon, authenticated;
