-- Evaluate scenario predicates directly on typed facts; no per-game function calls.
create or replace function public.get_assignment_matching_game_totals(p_organization_id uuid,p_filters jsonb default '{}'::jsonb)
returns jsonb language sql stable security invoker set search_path = '' as $$
 with params as materialized (select private.assignment_matching_validate(p_filters) f),
 clock as materialized (select f,coalesce(nullif(f->>'asOf','')::timestamptz,now()) as_of from params),
 facts as materialized (select g.* from clock c cross join lateral private.assignment_matching_facts(p_organization_id,c.as_of,null,c.f) g),
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
  else case when s.league_id is not null or s.level_id is not null or s.official_id is not null
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
