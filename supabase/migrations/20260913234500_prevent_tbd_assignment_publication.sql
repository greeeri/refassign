create or replace function public.prevent_tbd_assignment_publication()
returns trigger language plpgsql set search_path to '' as $function$
begin
  if new.published_at is not null
     and old.published_at is null
     and exists (
       select 1 from public.games
       where id = new.game_id and coalesce(time_tbd, false)
     ) then
    raise exception 'Enter the game time before publishing assignments.';
  end if;
  return new;
end;
$function$;

drop trigger if exists assignments_prevent_tbd_publication on public.assignments;
create trigger assignments_prevent_tbd_publication
before update of published_at on public.assignments
for each row execute function public.prevent_tbd_assignment_publication();
