create or replace function public.normalize_game_status()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if lower(trim(new.status)) = 'open' then
    new.status := 'active';
  end if;
  return new;
end;
$$;

drop trigger if exists normalize_game_status_trigger on public.games;
create trigger normalize_game_status_trigger
before insert or update of status on public.games
for each row execute function public.normalize_game_status();

update public.games
set status = 'active'
where lower(trim(status)) = 'open';

alter table public.games alter column status set default 'active';
alter table public.games drop constraint if exists games_status_check;
alter table public.games
  add constraint games_status_check
  check (status in ('active', 'canceled', 'suspended', 'rained_out'));

revoke all on function public.normalize_game_status() from public, anon, authenticated;
