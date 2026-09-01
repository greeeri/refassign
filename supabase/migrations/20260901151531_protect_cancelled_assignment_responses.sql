create or replace function public.protect_cancelled_assignment_status()
returns trigger language plpgsql set search_path='public' as $$
begin
  if old.status='cancelled' and new.status<>'cancelled'
     and exists(select 1 from public.games g where g.id=new.game_id and g.status in ('canceled','rained_out')) then
    raise exception 'This assignment belongs to a cancelled or rained-out game';
  end if;
  return new;
end; $$;
drop trigger if exists protect_cancelled_assignment_status_trigger on public.assignments;
create trigger protect_cancelled_assignment_status_trigger before update of status on public.assignments
for each row execute function public.protect_cancelled_assignment_status();
