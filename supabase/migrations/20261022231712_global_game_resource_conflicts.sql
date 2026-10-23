begin;

-- A row may be editable while the conflicting game is intentionally invisible.
-- This trigger is private and never expands the caller's SELECT permissions.
create or replace function private.enforce_global_game_resource_conflict()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_review_hold boolean := coalesce(new.venue_conflict_hold,false);
  v_end timestamptz;
  v_resources text[];
  v_lock bigint;
begin
  if tg_op = 'UPDATE' then
    v_review_hold := v_review_hold or coalesce(old.venue_conflict_hold,false);
    if old.venue_conflict_hold then new.venue_conflict_hold := true; end if;
  end if;
  -- Preserve source-review holds and cancellations. Ordinary suspended games
  -- still reserve their real teams/field, as before.
  if lower(coalesce(new.status,'active')) in ('canceled','cancelled','rained_out','rain_out')
    or (new.status='suspended' and v_review_hold) then return new; end if;
  if v_review_hold and (coalesce(new.time_tbd,false) or coalesce(new.field_tbd,false)
    or new.location_id is null or new.starts_at is null) then
    raise exception 'Venue conflict review: enter a confirmed location, field, date and time before activating this game. The game remains On Hold.' using errcode='23514';
  end if;
  if coalesce(new.time_tbd,false) or new.starts_at is null then return new; end if;

  v_resources := array['team:'||new.home_team_id::text,'team:'||new.away_team_id::text,
    case when not coalesce(new.field_tbd,false) then 'field:'||new.location_id::text end];
  if tg_op='UPDATE' then
    v_resources := v_resources || array['team:'||old.home_team_id::text,'team:'||old.away_team_id::text,
      case when not coalesce(old.field_tbd,false) then 'field:'||old.location_id::text end];
  end if;
  -- A deterministic global order avoids opposite home/away lock ordering.
  -- The volatile trigger's subsequent queries see a committed winner after
  -- waiting under PostgREST's READ COMMITTED transaction isolation.
  for v_lock in select distinct pg_catalog.hashtextextended(resource,0)
    from unnest(v_resources) resource where resource is not null order by 1
  loop
    perform pg_catalog.pg_advisory_xact_lock(v_lock);
  end loop;
  v_end := new.starts_at + pg_catalog.make_interval(mins=>coalesce(new.duration_minutes,110));
  if exists (
    select 1 from public.games g
    where g.id is distinct from new.id and not coalesce(g.time_tbd,false)
      and lower(coalesce(g.status,'active')) not in ('canceled','cancelled','rained_out','rain_out')
      and not (g.status='suspended' and g.venue_conflict_hold)
      and g.starts_at<v_end
      and g.starts_at+pg_catalog.make_interval(mins=>coalesce(g.duration_minutes,110))>new.starts_at
      and exists(select 1 from public.teams t where t.id in(new.home_team_id,new.away_team_id)
        and t.id in(g.home_team_id,g.away_team_id)
        and not(coalesce(t.source_system,'')='refassign-placeholder' and coalesce(t.source_team_id,'')='tbd'))
  ) then
    -- Do not disclose a hidden game's identifier, teams, time or organization.
    raise exception 'Team double-booking conflict. Resolve the schedule conflict before saving or activating this game.' using errcode='23514';
  end if;
  if new.location_id is not null and not coalesce(new.field_tbd,false) and exists (
    select 1 from public.games g
    where g.id is distinct from new.id and not coalesce(g.time_tbd,false) and not coalesce(g.field_tbd,false)
      and lower(coalesce(g.status,'active')) not in ('canceled','cancelled','rained_out','rain_out')
      and not (g.status='suspended' and g.venue_conflict_hold)
      and g.location_id=new.location_id and g.starts_at<v_end
      and g.starts_at+pg_catalog.make_interval(mins=>coalesce(g.duration_minutes,110))>new.starts_at
  ) then
    raise exception 'Venue conflict. Resolve the location or time overlap before saving or activating this game. The game remains On Hold.' using errcode='23514';
  end if;
  if v_review_hold and new.status='active' then new.venue_conflict_hold := false; end if;
  return new;
end;
$function$;

revoke all on function private.enforce_global_game_resource_conflict() from public,anon,authenticated;
-- Retire the caller-visible implementation; triggers do not require EXECUTE
-- permission for the role writing a row.
revoke all on function public.prevent_game_resource_double_booking() from public,anon,authenticated;
drop trigger if exists trg_prevent_game_resource_double_booking on public.games;
create trigger trg_prevent_game_resource_double_booking
before insert or update of starts_at,duration_minutes,home_team_id,away_team_id,location_id,status,time_tbd,field_tbd,venue_conflict_hold
on public.games for each row execute function private.enforce_global_game_resource_conflict();

commit;
