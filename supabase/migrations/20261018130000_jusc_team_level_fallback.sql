-- The user-defined ordering is oldest age, not UUID, name or crew size.
-- Accept one explicit U14 / 14u age token. Unknown labels and multi-age labels
-- have no order; same-age but distinct levels remain unresolved for review.
create function private.jusc_level_age(p_name text) returns integer
language sql immutable set search_path='' as $$
 select case when (select count(*) from regexp_matches(lower(p_name),'[0-9]+','g'))=1
  then (select nullif(coalesce(m[1],m[2])::int,0) from regexp_matches(lower(p_name),'(?:^|[^a-z0-9])(?:u[[:space:]-]*([0-9]{1,2})|([0-9]{1,2})[[:space:]-]*u)(?:$|[^a-z0-9])') m)
  else null end
$$;

-- Resolve uploaded teams within the feed's organization, sport and league selection.
-- A unique leveled upload may replace a legacy blank PlayMetrics duplicate, but
-- multiple uploaded identities are ambiguous and must never be picked by UUID.
create function private.resolve_jusc_team(p_org uuid,p_league uuid,p_sport uuid,p_name text,p_team uuid default null)
returns table(team_id uuid,level_id uuid,ambiguous boolean)
language sql stable set search_path='' as $$
 with candidates as (
  select t.id,l.id as level_id,t.source_system from public.teams t
  left join public.levels l on l.id=t.level_id and l.active
  where t.active and t.sport_id=p_sport and lower(btrim(t.name))=lower(btrim(p_name))
  and (t.organization_id=p_org or exists(select 1 from public.organization_teams o where o.organization_id=p_org and o.team_id=t.id))
  and not exists(select 1 from private.organization_league_team_settings s where s.organization_id=p_org and s.league_id=p_league and not(t.id=any(s.team_ids)))
 ), preferred as (
  select * from candidates c where (c.id=p_team and c.level_id is not null) or
  (not exists(select 1 from candidates x where x.id=p_team and x.level_id is not null) and not(c.level_id is null and coalesce(c.source_system,'')='playmetrics' and exists(select 1 from candidates x where x.level_id is not null)))
 ), counts as (select count(*) n from preferred)
 select (select id from preferred where (select n from counts)=1),
        (select level_id from preferred where (select n from counts)=1),
        (select n>1 from counts)
$$;

create or replace function private.jusc_team(p_org uuid,p_sport uuid,p_level uuid,p_name text,p_sex text) returns uuid language plpgsql set search_path='' as $$
declare t uuid; unclear boolean; league uuid:=nullif(current_setting('refassign.bound_league',true),'')::uuid;
begin
 select r.team_id,r.ambiguous into t,unclear from private.resolve_jusc_team(p_org,league,p_sport,p_name) r;
 if unclear then return null; end if;
 if t is null then
  -- Do not recreate a disconnected, inactive or league-excluded team under the
  -- same organization. The missing identity stays held for assignor review.
  if exists(select 1 from public.teams x where x.sport_id=p_sport and lower(btrim(x.name))=lower(btrim(p_name)) and
   (x.organization_id=p_org or exists(select 1 from public.organization_teams o where o.organization_id=p_org and o.team_id=x.id))) then return null; end if;
  -- A game's level is not necessarily either team's roster level.
  insert into public.teams(organization_id,sport_id,level_id,name,gender,source_system,source_team_id)
  values(p_org,p_sport,null,p_name,lower(p_sex),case when p_name in('Home TBD','Away TBD') then 'refassign-placeholder' else 'playmetrics' end,case when p_name in('Home TBD','Away TBD') then 'tbd' else null end) returning id into t;
 end if;
 insert into public.organization_teams(organization_id,team_id) values(p_org,t) on conflict do nothing;
 update private.organization_league_team_settings s set team_ids=array(select distinct unnest(s.team_ids||array[t])) where organization_id=p_org and league_id=league;
 return t;
end $$;

-- No bulk update/backfill: resolution happens only inside an authorized feed run.
CREATE OR REPLACE FUNCTION public.apply_jusc_calendar_feed(p_feed_id uuid, p_run_id uuid, p_events jsonb, p_hash text, p_etag text DEFAULT NULL::text, p_last_modified text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
#variable_conflict use_variable
declare
 f public.calendar_sync_feeds; e jsonb; prior public.calendar_sync_events; g public.games; candidate public.games; oldstate jsonb; facts jsonb; previous_facts jsonb;
 home_age int; away_age int; home_name text; away_name text; home_level uuid; away_level uuid; inferred_level uuid; home_ambiguous boolean; away_ambiguous boolean;
 uid text; lv uuid; loc uuid; sport uuid; bill uuid; crew int; matched int; conflict boolean; conflict_detail text; manual text; detail text; kind text; n_assign int;
 n_added int:=0; n_updated int:=0; n_removed int:=0; n_held int:=0; n_assigned int:=0; n_events int; source_changed boolean; new_game boolean; fields text[];
begin
 select * into f from public.calendar_sync_feeds where id=p_feed_id for update;
 if not found or f.lease_run_id is distinct from p_run_id or f.lease_until<now() then raise exception 'Calendar sync lease is missing or expired'; end if;
 perform pg_advisory_xact_lock(hashtextextended(f.organization_id::text||':gobound',0));
 perform set_config('refassign.bound_sync','on',true); perform set_config('refassign.bound_league',f.league_id::text,true);
 if p_events is null then n_events:=f.event_count;
 else
  if jsonb_typeof(p_events)<>'array' then raise exception 'Invalid event payload'; end if;
  n_events:=jsonb_array_length(p_events);
  if f.event_count>0 and (n_events=0 or n_events<(select count(*) from public.calendar_sync_events ce where ce.feed_id=f.id and ce.present and (ce.source_facts->>'date')::date >= (now() at time zone 'America/Chicago')::date)*0.75) then raise exception 'Calendar unexpectedly lost more than 25%% of its events; previous snapshot retained for review'; end if;
  if (select count(distinct x->>'uid') from jsonb_array_elements(p_events) x)<>n_events then raise exception 'Duplicate source UIDs'; end if;
  select id into strict sport from public.sports where name='Soccer';
  for e in select value from jsonb_array_elements(p_events) loop
   uid:=e->>'uid'; facts:=e->'facts'; if (facts->>'date')::date < (now() at time zone 'America/Chicago')::date then continue; end if;
   if uid !~ '^[0-9]+$' or facts is null or e->>'starts_at' is null then raise exception 'Invalid source event'; end if;
   select * into prior from public.calendar_sync_events where feed_id=f.id and calendar_sync_events.uid=uid;
   select count(*) into matched from public.games x where x.organization_id=f.organization_id and x.league_id=f.league_id and x.source_system='playmetrics' and x.source_match_id=uid;
   if matched>1 then raise exception 'Multiple existing games match source UID %; duplicates require review',uid; end if;
   select * into g from public.games x where x.organization_id=f.organization_id and x.league_id=f.league_id and x.source_system='playmetrics' and x.source_match_id=uid for update;
   new_game:=g.id is null;
   if new_game and prior.uid is not null then raise exception 'Previously imported game % was manually removed; restore or resolve it before syncing',uid; end if;
   if g.archived_at is not null then
    insert into public.calendar_sync_events(feed_id,uid,game_id,source_facts,applied_game,present) values(f.id,uid,g.id,facts,private.bound_game_state(g),true)
    on conflict on constraint calendar_sync_events_pkey do update set checked_at=now();
    continue;
   end if;
   -- A saved game level always wins, including a manual override. Resolve
   -- each team separately so the game level never becomes a roster-level filter.
   inferred_level:=g.level_id;
   if inferred_level is null and nullif(btrim(g.level),'') is null and coalesce(facts->>'level','')='' then
    home_name:=e->>'home_school'; away_name:=e->>'away_school';
    if g.id is not null and (g.home_team_id::text is distinct from prior.applied_game->>'home_team_id'
     or g.away_team_id::text is distinct from prior.applied_game->>'away_team_id'
     or exists(select 1 from public.teams t where t.id in(g.home_team_id,g.away_team_id) and (t.name ilike '%TBD%' or t.source_system='refassign-placeholder'))) then
     -- The sync preserves both roster IDs when either side was overridden.
     select t.name into home_name from public.teams t where t.id=g.home_team_id;
     select t.name into away_name from public.teams t where t.id=g.away_team_id;
    end if;
    select r.level_id,r.ambiguous into home_level,home_ambiguous from private.resolve_jusc_team(f.organization_id,f.league_id,sport,
     home_name,g.home_team_id) r;
    select r.level_id,r.ambiguous into away_level,away_ambiguous from private.resolve_jusc_team(f.organization_id,f.league_id,sport,
     away_name,g.away_team_id) r;
    if not home_ambiguous and not away_ambiguous then
     if home_level is null or away_level is null or home_level=away_level then inferred_level:=coalesce(home_level,away_level);
     else
      select private.jusc_level_age(name) into home_age from public.levels where id=home_level;
      select private.jusc_level_age(name) into away_age from public.levels where id=away_level;
      if home_age>away_age then inferred_level:=home_level;
      elsif away_age>home_age then inferred_level:=away_level; end if;
     end if;
    end if;
   end if;
   if inferred_level is not null then
    facts:=jsonb_set(facts,'{level}',to_jsonb((select name from public.levels where id=inferred_level)));
   elsif nullif(btrim(g.level),'') is not null then facts:=jsonb_set(facts,'{level}',to_jsonb(g.level));
   end if;
   previous_facts:=prior.source_facts;
   source_changed:=new_game or (prior.uid is null and g.level_id is null and inferred_level is not null) or (prior.uid is not null and (prior.source_facts is distinct from facts or not prior.present));
   if not source_changed then
    insert into public.calendar_sync_events(feed_id,uid,game_id,source_facts,applied_game,present) values(f.id,uid,g.id,facts,private.bound_game_state(g),true)
    on conflict on constraint calendar_sync_events_pkey do update set checked_at=now(),present=true;
    continue;
   end if;
   oldstate:=case when new_game then '{}'::jsonb else private.bound_game_state(g) end;
   fields:=array(select k from jsonb_object_keys(facts) k where previous_facts->k is distinct from facts->k);
   candidate:=g; manual:=''; conflict:=false; conflict_detail:=''; bill:=null;
   if new_game then
    candidate.id:=gen_random_uuid(); candidate.organization_id:=f.organization_id;candidate.league_id:=f.league_id; candidate.sport_id:=sport;
    candidate.status:=case when facts->>'status'='CANCELLED' then 'canceled' else 'suspended' end; candidate.venue_conflict_hold:=false;
   elsif g.source_event_id is distinct from f.source_event_id and exists(select 1 from public.calendar_sync_feeds owner_feed where owner_feed.source_event_id=g.source_event_id and owner_feed.organization_id=f.organization_id and owner_feed.league_id=f.league_id) then
    -- Overlapping subscriptions never overwrite the owning feed with conflicting facts.
    if exists(select 1 from public.calendar_sync_events other join public.calendar_sync_feeds ofeed on ofeed.id=other.feed_id where ofeed.source_event_id=g.source_event_id and other.uid=uid and other.present and other.source_facts is distinct from facts) then
     update public.games set calendar_needs_review=true,calendar_reviewed_at=null,calendar_reviewed_by=null,notes=concat_ws(' | ',nullif(notes,''),'Calendar feeds disagree; review source UID '||uid||' in '||f.name) where id=g.id;
     insert into public.calendar_sync_changes(run_id,game_id,uid,kind,before_source,after_source,details) values(p_run_id,g.id,uid,'source_conflict',previous_facts,facts,'Another subscribed feed reports conflicting facts; existing game preserved for assignor review.');
     n_updated:=n_updated+1;
    end if;
    insert into public.calendar_sync_events(feed_id,uid,game_id,source_facts,applied_game) values(f.id,uid,g.id,facts,oldstate) on conflict on constraint calendar_sync_events_pkey do update set source_facts=excluded.source_facts,checked_at=now(),present=true;
    continue;
   end if;
   if new_game or fields&&array['date','time'] then
    if new_game or oldstate->'starts_at'=prior.applied_game->'starts_at' and oldstate->'time_tbd'=prior.applied_game->'time_tbd' then
     candidate.starts_at:=(e->>'starts_at')::timestamptz;candidate.time_tbd:=(e->>'time_tbd')::boolean;
    else manual:=manual||' Date/time override preserved.'; end if;
   end if;
   if new_game or fields&&array['date','time','end'] then
    if new_game or oldstate->'duration_minutes'=prior.applied_game->'duration_minutes' then candidate.duration_minutes:=case when (e->>'duration')::numeric between 1 and 1440 and (e->>'duration')::numeric=trunc((e->>'duration')::numeric) then (e->>'duration')::int else coalesce(g.duration_minutes,110) end;
    else manual:=manual||' Duration override preserved.'; end if;
   end if;
   if new_game or 'level'=any(fields) then
    if new_game or (prior.uid is null and g.level_id is null and inferred_level is not null) or oldstate->'level_id'=prior.applied_game->'level_id' then
     lv:=inferred_level;
     if coalesce(facts->>'level','')<>'' then
      if lv is null then select id into lv from public.levels where lower(name)=lower(facts->>'level') order by active desc,id limit 1; end if;
      crew:=coalesce((e->>'crew')::int,3);
      if lv is null then insert into public.levels(name,officials_needed) values(facts->>'level',crew) returning id into lv; end if;
      insert into public.organization_levels(organization_id,level_id) values(f.organization_id,lv) on conflict do nothing;
      update private.organization_league_level_settings s set level_ids=array(select distinct unnest(s.level_ids||array[lv])) where organization_id=f.organization_id and league_id=f.league_id;
     else crew:=coalesce(g.officials_needed,3); end if;
     candidate.level_id:=lv;candidate.level:=nullif(facts->>'level','');
     if new_game or oldstate->'officials_needed'=prior.applied_game->'officials_needed' then candidate.officials_needed:=case when new_game then crew else g.officials_needed end; else manual:=manual||' Crew size override preserved.'; end if;
    else manual:=manual||' Level override preserved.'; end if;
   end if;
   if new_game or 'location'=any(fields) then
    if new_game or oldstate->'location_id'=prior.applied_game->'location_id' and oldstate->'field_tbd'=prior.applied_game->'field_tbd' then
     loc:=null;
     if coalesce(facts->>'location','')<>'' then
      select id into loc from public.locations where lower(name)=lower(facts->>'location') order by active desc,id limit 1;
      if loc is null then insert into public.locations(name,source_system,source_event_id) values(facts->>'location','playmetrics',f.source_event_id) returning id into loc; end if;
      insert into public.organization_locations(organization_id,location_id) values(f.organization_id,loc) on conflict do nothing;
     end if;
     candidate.location_id:=loc;candidate.field_tbd:=(e->>'field_tbd')::boolean;
    else manual:=manual||' Venue override preserved.'; end if;
   end if;
   if new_game or 'matchup'=any(fields) then
    if new_game or oldstate->'home_team_id'=prior.applied_game->'home_team_id' and oldstate->'away_team_id'=prior.applied_game->'away_team_id'
      and not exists(select 1 from public.teams t where t.id in(g.home_team_id,g.away_team_id) and (t.name ilike '%TBD%' or t.source_system='refassign-placeholder')) then
     candidate.home_team_id:=private.jusc_team(f.organization_id,sport,candidate.level_id,coalesce(e->>'home_school','Home TBD'),e->>'sex');
     candidate.away_team_id:=private.jusc_team(f.organization_id,sport,candidate.level_id,coalesce(e->>'away_school','Away TBD'),e->>'sex');
    else manual:=manual||' Team/TBD overrides preserved; source matchup requires review.'; end if;
   end if;
   if new_game and e->>'home_school' is not null then select id into bill from public.bill_to_accounts where organization_id=f.organization_id and lower(name)=lower(e->>'home_school') order by id limit 1; end if;
   if not new_game and 'status'=any(fields) and facts->>'status'='CANCELLED' and g.status<>'suspended' then candidate.status:='canceled'; end if;
   -- Source confirmation never releases a user hold or reactivates a cancellation.
   if lower(e->>'source_level')='jvr-a' or (e->>'duration')::numeric<>trunc((e->>'duration')::numeric) or facts->>'status'='TENTATIVE' or (e->>'time_tbd')::boolean or (e->>'field_tbd')::boolean or coalesce(facts->>'level','')='' or not ((e->>'duration')::numeric between 1 and 1440)
     or candidate.home_team_id is null or candidate.away_team_id is null
     or (new_game or 'matchup'=any(fields)) and (e->>'home_school' is null or e->>'away_school' is null) then
    if candidate.status<>'canceled' then candidate.status:='suspended'; end if;
   end if;
   if candidate.status<>'canceled' and not coalesce(candidate.time_tbd,false) then
    select x.game_number into conflict_detail from public.games x where x.id<>candidate.id and x.archived_at is null and not x.time_tbd and x.status not in('canceled','rained_out')
    and x.starts_at<candidate.starts_at+make_interval(mins=>candidate.duration_minutes) and x.starts_at+make_interval(mins=>x.duration_minutes)>candidate.starts_at
    and ((not coalesce(candidate.field_tbd,false) and not x.field_tbd and x.location_id=candidate.location_id) or exists(select 1 from public.teams t where t.id in(candidate.home_team_id,candidate.away_team_id) and t.id in(x.home_team_id,x.away_team_id) and coalesce(t.source_system,'')<>'refassign-placeholder')) order by x.starts_at,x.id limit 1;
    conflict:=found;
    if conflict then candidate.status:='suspended';candidate.venue_conflict_hold:=true; end if;
   end if;
   if candidate.status<>'canceled' and not coalesce(candidate.time_tbd,false) and not coalesce(candidate.field_tbd,false) and exists(select 1 from public.locations where id=candidate.location_id and lower(name)=lower(facts->>'location')) and exists(select 1 from jsonb_array_elements(p_events) o where o->>'uid'<>uid and not (o->>'time_tbd')::boolean and not (o->>'field_tbd')::boolean and o->'facts'->>'location'=facts->>'location' and (o->>'starts_at')::timestamptz<candidate.starts_at+make_interval(mins=>candidate.duration_minutes) and (o->>'starts_at')::timestamptz+make_interval(mins=>greatest(1,least(1440,(o->>'duration')::numeric))::int)>candidate.starts_at) then
    conflict:=true;candidate.status:='suspended';candidate.venue_conflict_hold:=true;conflict_detail:=coalesce(nullif(conflict_detail,''),'another overlapping source event');
   end if;
   detail:=case when new_game then 'Added from ' else 'Updated from ' end||f.name||': '||array_to_string(fields,', ')||'.'||manual;
   if jsonb_array_length(e->'issues')>0 then detail:=detail||' Source review: '||(select string_agg(value,' ') from jsonb_array_elements_text(e->'issues')); end if;
   if conflict then detail:=detail||' Resource conflict with Game #'||conflict_detail||'; resolve overlap before activation.'; end if;
   select count(*) into n_assign from public.assignments where game_id=g.id and status not in('cancelled','canceled','declined');
   if new_game then
    insert into public.games(id,organization_id,league_id,sport_id,level_id,level,location_id,home_team_id,away_team_id,starts_at,time_tbd,field_tbd,duration_minutes,officials_needed,status,venue_conflict_hold,bill_to_id,game_number,source_system,source_event_id,source_match_id,source_synced_at,calendar_needs_review,notes)
    values(candidate.id,f.organization_id,f.league_id,sport,candidate.level_id,candidate.level,candidate.location_id,candidate.home_team_id,candidate.away_team_id,candidate.starts_at,candidate.time_tbd,candidate.field_tbd,candidate.duration_minutes,candidate.officials_needed,candidate.status,candidate.venue_conflict_hold,bill,upper(uid),'playmetrics',f.source_event_id,uid,now(),true,
    'Source UID: '||uid||' | Original matchup: '||(facts->>'matchup')||' | Source status: '||(facts->>'status')||' | Source location: '||coalesce(nullif(facts->>'location',''),'not supplied')||' | Source date/time: '||(facts->>'date')||' '||coalesce(facts->>'time','TBD')||' | PlayMetrics JUSC | '||detail) returning * into g;
    n_added:=n_added+1;kind:='added';
   else
    update public.games set starts_at=candidate.starts_at,time_tbd=candidate.time_tbd,field_tbd=candidate.field_tbd,duration_minutes=candidate.duration_minutes,
    level_id=candidate.level_id,level=candidate.level,location_id=candidate.location_id,home_team_id=candidate.home_team_id,away_team_id=candidate.away_team_id,officials_needed=candidate.officials_needed,
    status=candidate.status,venue_conflict_hold=candidate.venue_conflict_hold,calendar_needs_review=true,calendar_reviewed_at=null,calendar_reviewed_by=null,source_synced_at=now(),
    notes=concat_ws(' | ',nullif(notes,''),to_char(now() at time zone 'America/Chicago','YYYY-MM-DD')||' calendar sync: '||detail||' Source facts: '||facts::text) where id=g.id returning * into g;
    n_updated:=n_updated+1;kind:='updated';
   end if;
   if g.status='suspended' then n_held:=n_held+1; end if; if n_assign>0 then n_assigned:=n_assigned+1; end if;
   insert into public.calendar_sync_changes(run_id,game_id,uid,kind,before_source,after_source,details,assignments_affected) values(p_run_id,g.id,uid,kind,previous_facts,facts,detail,n_assign);
   -- Advance only fields this run actually applied. Manual overrides keep their previous comparison values.
   insert into public.calendar_sync_events(feed_id,uid,game_id,source_facts,applied_game,present) values(f.id,uid,g.id,facts,case when new_game or prior.uid is null then private.bound_game_state(g) else prior.applied_game||coalesce((select jsonb_object_agg(k,v) from jsonb_each(private.bound_game_state(g)) x(k,v) where oldstate->k is not distinct from prior.applied_game->k),'{}'::jsonb) end,true)
   on conflict on constraint calendar_sync_events_pkey do update set source_facts=excluded.source_facts,applied_game=excluded.applied_game,present=true,checked_at=now();
  end loop;
  for prior in select * from public.calendar_sync_events s where s.feed_id=f.id and s.present and (s.source_facts->>'date')::date >= (now() at time zone 'America/Chicago')::date and not exists(select 1 from jsonb_array_elements(p_events) x where x->>'uid'=s.uid) loop
   update public.calendar_sync_events set present=false,checked_at=now() where feed_id=f.id and calendar_sync_events.uid=prior.uid;
   if exists(select 1 from public.calendar_sync_events s where s.uid=prior.uid and s.feed_id<>f.id and s.present) then continue; end if;
   select * into g from public.games where id=prior.game_id for update;
   if g.id is null or g.archived_at is not null then continue; end if;
   select count(*) into n_assign from public.assignments where game_id=g.id and status not in('cancelled','canceled','declined');
   update public.games set status=case when status='canceled' then status else 'suspended' end,calendar_needs_review=true,calendar_reviewed_at=null,calendar_reviewed_by=null,source_synced_at=now(),notes=concat_ws(' | ',nullif(notes,''),'Removed from source calendar '||f.name||' on '||to_char(now() at time zone 'America/Chicago','YYYY-MM-DD')||'; game retained for assignor review.') where id=g.id;
   insert into public.calendar_sync_changes(run_id,game_id,uid,kind,before_source,details,assignments_affected) values(p_run_id,g.id,prior.uid,'removed',prior.source_facts,'Source entry removed; game retained and held for review.',n_assign);
   n_removed:=n_removed+1;n_held:=n_held+1;if n_assign>0 then n_assigned:=n_assigned+1;end if;
  end loop;
 end if;
 update public.calendar_sync_runs set status='success',finished_at=now(),events_found=n_events,games_added=n_added,games_updated=n_updated,games_removed=n_removed,games_held=n_held,assigned_games_affected=n_assigned where id=p_run_id;
 update public.calendar_sync_feeds set last_success_at=now(),last_error=null,failure_count=0,event_count=n_events,content_hash=coalesce(p_hash,content_hash),etag=p_etag,last_modified=p_last_modified,
 next_run_at=private.next_jusc_calendar_check(now()),lease_run_id=null,lease_until=null where id=f.id;
 perform set_config('refassign.bound_sync','off',true);
 return jsonb_build_object('feed',f.name,'events',n_events,'added',n_added,'updated',n_updated,'removed',n_removed,'held',n_held,'assigned_games_affected',n_assigned);
end $function$;


revoke all on function private.jusc_level_age(text),private.resolve_jusc_team(uuid,uuid,uuid,text,uuid) from public,anon,authenticated;
grant execute on function private.jusc_level_age(text),private.resolve_jusc_team(uuid,uuid,uuid,text,uuid) to service_role;
