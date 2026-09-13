alter table public.games
  add column if not exists time_tbd boolean not null default false,
  add column if not exists field_tbd boolean not null default false;

create or replace function public.prevent_game_resource_double_booking()
returns trigger language plpgsql set search_path to 'public' as $function$
declare v_conflict record; v_new_end timestamptz;
begin
  if coalesce(new.time_tbd,false) then return new; end if;
  v_new_end := new.starts_at + make_interval(mins => coalesce(new.duration_minutes,110));
  if new.home_team_id is not null or new.away_team_id is not null then
    select g.game_number,g.starts_at,g.duration_minutes into v_conflict from public.games g
    where g.id<>new.id and not coalesce(g.time_tbd,false)
      and coalesce(g.status,'open') not in ('cancelled','canceled')
      and g.starts_at<v_new_end and g.starts_at+make_interval(mins=>coalesce(g.duration_minutes,110))>new.starts_at
      and ((new.home_team_id is not null and (g.home_team_id=new.home_team_id or g.away_team_id=new.home_team_id))
        or (new.away_team_id is not null and (g.home_team_id=new.away_team_id or g.away_team_id=new.away_team_id))) limit 1;
    if found then raise exception 'Team double-booking conflict with Game #% at %',v_conflict.game_number,to_char(v_conflict.starts_at at time zone 'America/Chicago','MM/DD/YYYY FMHH12:MI AM') using errcode='23514'; end if;
  end if;
  if new.location_id is not null and not coalesce(new.field_tbd,false) then
    select g.game_number,g.starts_at,g.duration_minutes into v_conflict from public.games g
    where g.id<>new.id and not coalesce(g.time_tbd,false) and not coalesce(g.field_tbd,false)
      and coalesce(g.status,'open') not in ('cancelled','canceled') and g.location_id=new.location_id
      and g.starts_at<v_new_end and g.starts_at+make_interval(mins=>coalesce(g.duration_minutes,110))>new.starts_at limit 1;
    if found then raise exception 'Location double-booking conflict with Game #% at %',v_conflict.game_number,to_char(v_conflict.starts_at at time zone 'America/Chicago','MM/DD/YYYY FMHH12:MI AM') using errcode='23514'; end if;
  end if;
  return new;
end;
$function$;

create or replace function public.prevent_inactive_game_assignment()
returns trigger language plpgsql set search_path to '' as $function$
declare v_game_status text;
begin
  select lower(coalesce(status,'')) into v_game_status from public.games where id=new.game_id;
  if v_game_status in ('suspended','hold','on_hold','rained_out','rain_out','canceled','cancelled')
    and lower(coalesce(new.status,'')) not in ('canceled','cancelled') then
    if current_setting('refassign.auto_assign',true)='on' then return null; end if;
    raise exception 'Assignments cannot be added to On Hold, Rain Out, or Cancelled games.';
  end if;
  return new;
end;
$function$;

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
