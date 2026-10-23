-- Opt-in whole venue-local today and future paging without aggregate work.
create or replace function public.get_assignment_matching_game_page(p_organization_id uuid,p_filters jsonb default '{}'::jsonb,p_page integer default 1,p_page_size integer default 50)
returns table(game_id uuid) language plpgsql stable security invoker set search_path = '' as $$
declare f jsonb:=private.assignment_matching_validate(p_filters);
 as_of timestamptz:=coalesce(nullif(f->>'asOf','')::timestamptz,now());
 size integer:=least(50,greatest(1,coalesce(p_page_size,50)));
 skip bigint:=(greatest(1,coalesce(p_page,1))::bigint-1)*size;
 derived boolean:=nullif(f->>'officialId','') is not null or coalesce((f->>'unpublishedOnly')::boolean,false)
  or coalesce((f->>'selfAssignOnly')::boolean,false) or coalesce((f->>'replacementOnly')::boolean,false)
  or coalesce(jsonb_array_length(nullif(f->'completeness','null'::jsonb)),0)>0;
 explicit_filter boolean:=coalesce(f->>'range','all')<>'all' or derived
  or nullif(f->>'leagueId','') is not null or nullif(f->>'levelId','') is not null
  or (f ? 'locationIds' and f->'locationIds'<>'null'::jsonb)
  or coalesce(jsonb_array_length(nullif(f->'days','null'::jsonb)),0)>0
  or coalesce(jsonb_array_length(nullif(f->'times','null'::jsonb)),0)>0;
 today_forward boolean:=coalesce((f->>'todayForward')::boolean,false)
  and coalesce(f->>'range','all')='all'
  and coalesce(jsonb_array_length(nullif(f->'days','null'::jsonb)),0)=0
  and nullif(f->>'focusGameId','') is null;
 candidate record; venue_zone text; venue_zones jsonb:='{}'::jsonb;
 qualifying bigint:=0; emitted integer:=0;
 is_owner boolean:=private.can_manage_organization(p_organization_id);
begin
 if today_forward and not derived then
  -- The supported US venue zones have at most a 25-hour local day. A 26-hour
  -- indexed look-back is conservative across DST, then the exact local-date
  -- comparison below rejects yesterday. The cursor exits at the requested page.
  for candidate in
   select g.id,g.starts_at,g.location_id,g.time_tbd from public.games g
   where (select auth.uid()) is not null and p_organization_id is not null
    and g.organization_id=p_organization_id and g.archived_at is null
    and g.starts_at>=as_of-interval '26 hours'
    and (is_owner or private.can_access_organization_league_location(g.organization_id,g.league_id,g.location_id,(select auth.uid())))
    and (nullif(f->>'leagueId','') is null or g.league_id::text=f->>'leagueId')
    and (nullif(f->>'levelId','') is null or g.level_id::text=f->>'levelId')
    and (not f ? 'locationIds' or f->'locationIds'='null'::jsonb or f->'locationIds' ? g.location_id::text)
   order by g.starts_at,g.id
  loop
   venue_zone:=venue_zones->>coalesce(candidate.location_id::text,'none');
   if venue_zone is null then
    select private.assignment_matching_timezone(l.state) into venue_zone from public.locations l where l.id=candidate.location_id;
    venue_zone:=coalesce(venue_zone,'America/Chicago');
    venue_zones:=venue_zones||jsonb_build_object(coalesce(candidate.location_id::text,'none'),venue_zone);
   end if;
   if (candidate.starts_at at time zone venue_zone)::date<(as_of at time zone venue_zone)::date then continue; end if;
   if coalesce(jsonb_array_length(nullif(f->'times','null'::jsonb)),0)>0
    and (coalesce(candidate.time_tbd,false) or not (f->'times' ? to_char(candidate.starts_at at time zone venue_zone,'HH24:MI'))) then continue; end if;
   qualifying:=qualifying+1;
   if qualifying<=skip then continue; end if;
   game_id:=candidate.id; return next;
   emitted:=emitted+1;
   if emitted>=size then return; end if;
  end loop;
  return;
 elsif not explicit_filter then
  -- Initial upcoming page and exact focus need no assignment/location reads.
  return query select g.id from public.games g
   where (select auth.uid()) is not null and p_organization_id is not null
    and g.organization_id=p_organization_id and g.archived_at is null
    and (is_owner or private.can_access_organization_league_location(g.organization_id,g.league_id,g.location_id,(select auth.uid())))
    and ((nullif(f->>'focusGameId','') is null and g.starts_at>=as_of)
      or (nullif(f->>'focusGameId','') is not null and g.id::text=f->>'focusGameId'))
   order by g.starts_at,g.id limit size offset skip;
 elsif not derived then
  return query with games as materialized (
   select g.* from public.games g where (select auth.uid()) is not null and p_organization_id is not null
    and g.organization_id=p_organization_id and g.archived_at is null
    and (is_owner or private.can_access_organization_league_location(g.organization_id,g.league_id,g.location_id,(select auth.uid())))
    and (nullif(f->>'leagueId','') is null or g.league_id::text=f->>'leagueId')
    and (nullif(f->>'levelId','') is null or g.level_id::text=f->>'levelId')
    and (not f ? 'locationIds' or f->'locationIds'='null'::jsonb or f->'locationIds' ? g.location_id::text)
  ), locations as materialized (
   select l.id,private.assignment_matching_timezone(l.state) zone from public.locations l where l.id in (select g.location_id from games g)
  ) select g.id from games g left join locations l on l.id=g.location_id
  where private.assignment_matching_predicate(jsonb_build_object(
   'id',g.id,'startsAt',g.starts_at,'leagueId',g.league_id,'levelId',g.level_id,'locationId',g.location_id,
   'localDate',to_char(g.starts_at at time zone coalesce(l.zone,'America/Chicago'),'YYYY-MM-DD'),
   'localTime',to_char(g.starts_at at time zone coalesce(l.zone,'America/Chicago'),'HH24:MI'),
   'today',to_char(as_of at time zone coalesce(l.zone,'America/Chicago'),'YYYY-MM-DD'),'timeTbd',coalesce(g.time_tbd,false),
   'officialIds','[]'::jsonb,'unpublished',false,'selfAssign',false,'replacement',false,'completeness','unassigned'),f,as_of)
  order by g.starts_at,g.id limit size offset skip;
 else
  return query select x.game_id from private.assignment_matching_facts(p_organization_id,as_of,null,f) x
   where private.assignment_matching_predicate(x.facts,f,as_of)
    and (not today_forward or (x.facts->>'localDate')::date>=(x.facts->>'today')::date)
   order by x.starts_at,x.game_id limit size offset skip;
 end if;
end $$;

-- Bound derived-filter fact work to the same conservative date window.
-- Keep caller RLS and exact filter semantics; eliminate repeated correlated
-- policy evaluation. This replaces only read-only routines, not access rules.
create or replace function private.assignment_matching_facts(p_organization_id uuid,p_as_of timestamptz,p_game_id uuid default null,p_base_filters jsonb default '{}'::jsonb)
returns table(game_id uuid,starts_at timestamptz,facts jsonb)
language sql stable security invoker set search_path = '' set enable_nestloop = off as $$
 with authority as materialized (select private.can_manage_organization(p_organization_id) is_owner),
 games as materialized (
  select g.id,g.starts_at,g.league_id,g.level_id,g.location_id,g.sport_id,g.officials_needed,g.time_tbd
  from public.games g cross join authority au
  where (select auth.uid()) is not null and p_organization_id is not null
   and g.organization_id=p_organization_id and g.archived_at is null
   and (not (coalesce((p_base_filters->>'todayForward')::boolean,false)
    and coalesce(p_base_filters->>'range','all')='all'
    and coalesce(jsonb_array_length(nullif(p_base_filters->'days','null'::jsonb)),0)=0
    and nullif(p_base_filters->>'focusGameId','') is null)
    or g.starts_at>=p_as_of-interval '26 hours')
   and (p_game_id is null or g.id=p_game_id)
   and (nullif(p_base_filters->>'leagueId','') is null or g.league_id::text=p_base_filters->>'leagueId')
   and (nullif(p_base_filters->>'levelId','') is null or g.level_id::text=p_base_filters->>'levelId')
   and (not p_base_filters ? 'locationIds' or p_base_filters->'locationIds'='null'::jsonb or p_base_filters->'locationIds' ? g.location_id::text)
   and (au.is_owner or private.can_access_organization_league_location(g.organization_id,g.league_id,g.location_id,(select auth.uid())))
 ), locations as materialized (
  select l.id,private.assignment_matching_timezone(l.state) zone from public.locations l
  where l.id in (select g.location_id from games g)
 ), positions as materialized (
  select p.id,p.sport_id,row_number() over(partition by p.sport_id order by p.sort_order,p.id) ordinal
  from public.sport_positions p where p.sport_id in (select g.sport_id from games g)
 ), assignments as materialized (
  select x.game_id,x.official_id,x.position_id,x.status,x.published_at,x.assignment_source,x.accept_by
  from public.assignments x where x.game_id in (select g.id from games g)
 ), removals as materialized (
  select distinct h.game_id,h.old_data->>'position_id' position_id from public.audit_history h
  where h.action='unassigned' and h.game_id in (select g.id from games g)
 ), self_assign as materialized (
  select distinct s.game_id from public.assignment_self_assign_slots s
  where s.status='open' and s.game_id in (select g.id from games g)
 ), slot_stats as materialized (
  select g.id game_id,p.id position_id,
   count(x.position_id) filter(where x.status<>'declined')>0 filled,
   count(x.position_id) filter(where x.status<>'declined')=0
    and (count(x.position_id) filter(where x.status='declined')>0 or bool_or(r.game_id is not null)) replacement,
   coalesce(bool_or(x.status='proposed' and x.published_at is not null and x.assignment_source in ('auto_assign','manager') and x.accept_by<p_as_of),false) overdue,
   coalesce(bool_and(x.status in ('accepted','confirmed')) filter(where x.status<>'declined'),true) confirmed,
   coalesce(bool_and(x.published_at is not null) filter(where x.status<>'declined'),true) published
  from games g join positions p on p.sport_id=g.sport_id and p.ordinal<=greatest(0,coalesce(g.officials_needed,0))
  left join assignments x on x.game_id=g.id and x.position_id=p.id
  left join removals r on r.game_id=g.id and r.position_id=p.id::text
  group by g.id,p.id
 ), staffing as materialized (
  select st.game_id,count(*) slot_count,count(*) filter(where st.filled) filled,
   coalesce(bool_or(st.replacement),false) replacement,coalesce(bool_or(st.overdue),false) overdue,
   coalesce(bool_and(st.confirmed),false) confirmed,coalesce(bool_and(st.published),false) published
  from slot_stats st group by st.game_id
 ), assignment_stats as materialized (
  select x.game_id,jsonb_agg(distinct x.official_id) filter(where x.status<>'declined') official_ids,
   coalesce(bool_or(x.published_at is null) filter(where x.status<>'declined'),false) unpublished
  from assignments x group by x.game_id
 )
 select g.id,g.starts_at,jsonb_build_object(
  'id',g.id,'startsAt',g.starts_at,'leagueId',g.league_id,'levelId',g.level_id,'locationId',g.location_id,
  'localDate',to_char(g.starts_at at time zone coalesce(l.zone,'America/Chicago'),'YYYY-MM-DD'),
  'localTime',to_char(g.starts_at at time zone coalesce(l.zone,'America/Chicago'),'HH24:MI'),
  'today',to_char(p_as_of at time zone coalesce(l.zone,'America/Chicago'),'YYYY-MM-DD'),'timeTbd',coalesce(g.time_tbd,false),
  'officialIds',coalesce(a.official_ids,'[]'::jsonb),'unpublished',coalesce(a.unpublished,false),
  'selfAssign',sa.game_id is not null,'replacement',coalesce(st.replacement,false),
  'completeness',case when st.replacement then 'attention'
   when coalesce(st.slot_count,0)=0 or coalesce(st.filled,0)=0 then 'unassigned'
   when st.filled<st.slot_count then 'partial' when st.overdue then 'attention'
   when st.confirmed then 'confirmed' when st.published then 'awaiting' else 'full' end)
 from games g left join locations l on l.id=g.location_id left join assignment_stats a on a.game_id=g.id
 left join staffing st on st.game_id=g.id left join self_assign sa on sa.game_id=g.id
$$;


-- Optional explicit totals retain all date facets; never required for paging.
-- Evaluate scenario predicates directly on typed facts; no per-game function calls.
create or replace function public.get_assignment_matching_game_totals(p_organization_id uuid,p_filters jsonb default '{}'::jsonb)
returns jsonb language sql stable security invoker set search_path = '' as $$
 with params as materialized (select private.assignment_matching_validate(p_filters) f),
 clock as materialized (select f,coalesce(nullif(f->>'asOf','')::timestamptz,now()) as_of from params),
 facts as materialized (select g.* from clock c cross join lateral private.assignment_matching_facts(p_organization_id,c.as_of,null,c.f-'todayForward') g),
 raw_scenarios as (
  select 'total' category,'total' key,f from clock
  union all select 'ranges',r,f||jsonb_build_object('range',r) from clock cross join unnest(array['all','today','tomorrow','thisWeek','nextWeek','custom','dateRange']) r
  union all select 'facets','unpublished',f||'{"unpublishedOnly":true,"replacementOnly":false}'::jsonb from clock
  union all select 'facets','selfAssign',f||'{"selfAssignOnly":true}'::jsonb from clock
  union all select 'facets','replacement',f||'{"replacementOnly":true}'::jsonb from clock
  union all select 'completeness',v,f||jsonb_build_object('completeness',jsonb_build_array(v),'replacementOnly',false)
    from clock cross join unnest(array['unassigned','partial','full','awaiting','confirmed','attention']) v
  union all select 'queue','replacement',f||'{"replacementOnly":true,"completeness":[],"unpublishedOnly":false,"selfAssignOnly":false}'::jsonb from clock
  union all select 'facets','allStatuses',f||'{"replacementOnly":false,"completeness":[]}'::jsonb from clock
  union all select 'queue','attention',f||'{"replacementOnly":false,"completeness":["attention"]}'::jsonb from clock
  union all select 'queue','unassigned',f||'{"replacementOnly":false,"completeness":["unassigned"]}'::jsonb from clock
  union all select 'queue','awaiting',f||'{"replacementOnly":false,"completeness":["awaiting"]}'::jsonb from clock
  union all select 'queue','unpublished',f||'{"unpublishedOnly":true,"replacementOnly":false,"completeness":[]}'::jsonb from clock
 ), scenarios as materialized (
 select category,key,f,coalesce(f->>'range','all') range_name,
 nullif(f->>'customDate','')::date custom_date,nullif(f->>'fromDate','')::date from_date,nullif(f->>'toDate','')::date to_date,
 nullif(f->>'leagueId','') league_id,nullif(f->>'levelId','') level_id,nullif(f->>'officialId','') official_id,
 nullif(f->>'focusGameId','') focus_game_id,
 coalesce(jsonb_array_length(nullif(f->'days','null'::jsonb)),0)>0 has_days,
 coalesce(jsonb_array_length(nullif(f->'times','null'::jsonb)),0)>0 has_times,
 coalesce(jsonb_array_length(nullif(f->'completeness','null'::jsonb)),0)>0 has_status,
 (f ? 'locationIds' and f->'locationIds'<>'null'::jsonb) has_locations,
 coalesce((f->>'unpublishedOnly')::boolean,false) unpublished,
 coalesce((f->>'selfAssignOnly')::boolean,false) self_assign,
 coalesce((f->>'replacementOnly')::boolean,false) replacement
 from raw_scenarios
 ), typed_facts as materialized (
 select game_id,starts_at,facts,
 (facts->>'localDate')::date local_date,(facts->>'today')::date today,
 (facts->>'today')::date-(extract(isodow from (facts->>'today')::date)::int-1) week_start
 from facts
 ), counts as (
  select s.category,s.key,count(g.game_id) n from scenarios s cross join clock c
  left join typed_facts g on coalesce(
 (case s.range_name
  when 'today' then g.local_date=g.today
  when 'tomorrow' then g.local_date=g.today+1
  when 'thisWeek' then g.local_date>=g.week_start and g.local_date<g.week_start+7
  when 'nextWeek' then g.local_date>=g.week_start+7 and g.local_date<g.week_start+14
  when 'custom' then g.local_date=s.custom_date
  when 'dateRange' then (s.from_date is not null or s.to_date is not null)
   and (s.from_date is null or g.local_date>=s.from_date) and (s.to_date is null or g.local_date<=s.to_date)
  else case when coalesce((s.f->>'todayForward')::boolean,false) and not s.has_days and s.focus_game_id is null then g.local_date>=g.today
   when s.league_id is not null or s.level_id is not null or s.official_id is not null
    or s.has_locations or s.has_days or s.has_times or s.has_status or s.unpublished or s.self_assign or s.replacement then true
   when s.focus_game_id is not null then g.facts->>'id'=s.focus_game_id
   else g.starts_at>=c.as_of end end)
 and (s.league_id is null or g.facts->>'leagueId'=s.league_id)
 and (s.level_id is null or g.facts->>'levelId'=s.level_id)
 and (s.official_id is null or g.facts->'officialIds' ? s.official_id)
 and (not s.has_locations or s.f->'locationIds' ? (g.facts->>'locationId'))
 and (not s.has_days or s.f->'days' ? (g.facts->>'localDate'))
 and (not s.has_times or (not (g.facts->>'timeTbd')::boolean and s.f->'times' ? (g.facts->>'localTime')))
 and (not s.unpublished or (g.facts->>'unpublished')::boolean)
 and (not s.self_assign or (g.facts->>'selfAssign')::boolean)
 and (not s.replacement or (g.facts->>'replacement')::boolean)
 and (not s.has_status or s.f->'completeness' ? (g.facts->>'completeness')),false) group by s.category,s.key
 ), groups as (select category,jsonb_object_agg(key,n) value from counts group by category)
 select coalesce((select value from groups where category='total'),'{}'::jsonb)
  || coalesce((select value from groups where category='facets'),'{}'::jsonb)
  || jsonb_build_object('ranges',coalesce((select value from groups where category='ranges'),'{}'::jsonb),
    'completeness',coalesce((select value from groups where category='completeness'),'{}'::jsonb),
    'queue',coalesce((select value from groups where category='queue'),'{}'::jsonb))
$$;
