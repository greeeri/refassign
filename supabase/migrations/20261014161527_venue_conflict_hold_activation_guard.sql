alter table public.games add column if not exists venue_conflict_hold boolean not null default false;

create or replace function public.prevent_game_resource_double_booking()
returns trigger language plpgsql set search_path to 'public' as $function$
declare
  v_conflict record;
  v_new_end timestamptz;
  v_review_hold boolean;
begin
  v_review_hold := new.venue_conflict_hold;
  if tg_op = 'UPDATE' then
    v_review_hold := v_review_hold or old.venue_conflict_hold;
    -- A review hold is cleared only by a successful activation, never by editing the flag.
    if old.venue_conflict_hold then new.venue_conflict_hold := true; end if;
  end if;
  if coalesce(new.status,'active') in ('canceled','cancelled','rained_out')
     or (new.status = 'suspended' and v_review_hold) then
    return new;
  end if;
  if v_review_hold and (coalesce(new.time_tbd,false) or coalesce(new.field_tbd,false) or new.location_id is null) then
    raise exception 'Venue conflict review: enter a confirmed location, field, date and time before activating this game. The game remains On Hold.' using errcode='23514';
  end if;
  if coalesce(new.time_tbd,false) then return new; end if;
  v_new_end := new.starts_at + make_interval(mins => coalesce(new.duration_minutes,110));
  if new.home_team_id is not null or new.away_team_id is not null then
    select g.game_number,g.starts_at into v_conflict
    from public.games g
    where g.id<>new.id and not coalesce(g.time_tbd,false)
      and coalesce(g.status,'active') not in ('canceled','cancelled','rained_out')
      and not (g.status='suspended' and g.venue_conflict_hold)
      and g.starts_at<v_new_end
      and g.starts_at+make_interval(mins=>coalesce(g.duration_minutes,110))>new.starts_at
      and exists (
        select 1 from public.teams t
        where t.id in (new.home_team_id,new.away_team_id)
          and (g.home_team_id=t.id or g.away_team_id=t.id)
          and not (coalesce(t.source_system,'')='refassign-placeholder' and coalesce(t.source_team_id,'')='tbd')
      ) order by g.starts_at,g.id limit 1;
    if found then
      raise exception 'Team double-booking conflict with Game #% at %. Resolve the conflict before activating this game.',v_conflict.game_number,to_char(v_conflict.starts_at at time zone 'America/Chicago','MM/DD/YYYY FMHH12:MI AM') using errcode='23514';
    end if;
  end if;
  if new.location_id is not null and not coalesce(new.field_tbd,false) then
    select g.game_number,g.starts_at,l.name into v_conflict
    from public.games g join public.locations l on l.id=g.location_id
    where g.id<>new.id and not coalesce(g.time_tbd,false) and not coalesce(g.field_tbd,false)
      and coalesce(g.status,'active') not in ('canceled','cancelled','rained_out')
      and not (g.status='suspended' and g.venue_conflict_hold)
      and g.location_id=new.location_id
      and g.starts_at<v_new_end
      and g.starts_at+make_interval(mins=>coalesce(g.duration_minutes,110))>new.starts_at
    order by g.starts_at,g.id limit 1;
    if found then
      raise exception 'Venue conflict at % with Game #% at %. Resolve the location or time overlap before activating this game. The game remains On Hold.',v_conflict.name,v_conflict.game_number,to_char(v_conflict.starts_at at time zone 'America/Chicago','MM/DD/YYYY FMHH12:MI AM') using errcode='23514';
    end if;
  end if;
  if v_review_hold and new.status='active' then new.venue_conflict_hold := false; end if;
  return new;
end;
$function$;

drop trigger if exists trg_prevent_game_resource_double_booking on public.games;
create trigger trg_prevent_game_resource_double_booking
before insert or update of starts_at,duration_minutes,home_team_id,away_team_id,location_id,status,time_tbd,field_tbd,venue_conflict_hold
on public.games for each row execute function public.prevent_game_resource_double_booking();
