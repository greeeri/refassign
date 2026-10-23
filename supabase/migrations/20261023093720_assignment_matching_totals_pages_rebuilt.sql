-- Rebuilt release: caller-permission reads only. Existing tables, grants,
-- records, policies, and assignments are not modified.
create or replace function private.assignment_matching_timezone(p_state text)
returns text language sql immutable security invoker set search_path = '' as $$
 select case upper(trim(coalesce(p_state,'')))
 when 'AZ' then 'America/Phoenix' when 'AK' then 'America/Anchorage' when 'HI' then 'Pacific/Honolulu'
 else case when upper(trim(coalesce(p_state,''))) = any(array['CA','NV','OR','WA']) then 'America/Los_Angeles'
 when upper(trim(coalesce(p_state,''))) = any(array['CO','ID','MT','NM','UT','WY']) then 'America/Denver'
 when upper(trim(coalesce(p_state,''))) = any(array['CT','DC','DE','FL','GA','IN','KY','MA','MD','ME','MI','NC','NH','NJ','NY','OH','PA','RI','SC','VA','VT','WV']) then 'America/New_York'
 else 'America/Chicago' end end
$$;

create or replace function private.assignment_matching_validate(p_filters jsonb)
returns jsonb language plpgsql immutable security invoker set search_path = '' as $$
declare k text; f jsonb := coalesce(p_filters,'{}'::jsonb);
begin
 if jsonb_typeof(f) <> 'object' then raise exception 'Game filters must be an object' using errcode='22023'; end if;
 if coalesce(f->>'range','all') not in ('all','today','tomorrow','thisWeek','nextWeek','custom','dateRange') then
  raise exception 'Invalid date range' using errcode='22023'; end if;
 foreach k in array array['days','times','completeness','locationIds'] loop
  if f ? k and f->k <> 'null'::jsonb then
   if jsonb_typeof(f->k) <> 'array' then raise exception 'Invalid % filter',k using errcode='22023'; end if;
   if jsonb_array_length(f->k)>2000 then raise exception 'Too many % filters',k using errcode='22023'; end if;
   if exists(select 1 from jsonb_array_elements(f->k) e where jsonb_typeof(e)<>'string') then
    raise exception 'Invalid % filter entries',k using errcode='22023'; end if;
  end if;
 end loop;
 if coalesce(f->>'range','all')='dateRange' and nullif(f->>'fromDate','') is not null and nullif(f->>'toDate','') is not null and (f->>'fromDate')::date>(f->>'toDate')::date then
  raise exception 'From date must not be after To date' using errcode='22023'; end if;
 return f;
end $$;

create or replace function private.assignment_matching_facts(p_organization_id uuid,p_as_of timestamptz,p_game_id uuid default null,p_base_filters jsonb default '{}'::jsonb)
returns table(game_id uuid,starts_at timestamptz,facts jsonb)
language sql stable security invoker set search_path = '' as $$
 select g.id,g.starts_at,jsonb_build_object(
  'id',g.id,'startsAt',g.starts_at,'leagueId',g.league_id,'levelId',g.level_id,'locationId',g.location_id,
  'localDate',to_char(g.starts_at at time zone tz.zone,'YYYY-MM-DD'),
  'localTime',to_char(g.starts_at at time zone tz.zone,'HH24:MI'),
  'today',to_char(p_as_of at time zone tz.zone,'YYYY-MM-DD'),'timeTbd',coalesce(g.time_tbd,false),
  'officialIds',coalesce(a.official_ids,'[]'::jsonb),'unpublished',coalesce(a.unpublished,false),
  'selfAssign',exists(select 1 from public.assignment_self_assign_slots s where s.game_id=g.id and s.status='open'),
  'replacement',coalesce(a.replacement,false),
  'completeness',case when a.replacement then 'attention'
   when a.slot_count=0 or a.filled=0 then 'unassigned'
   when a.filled<a.slot_count then 'partial'
   when a.overdue then 'attention'
   when a.confirmed then 'confirmed'
   when a.published then 'awaiting' else 'full' end)
 from public.games g
 left join public.locations l on l.id=g.location_id
 cross join lateral (select private.assignment_matching_timezone(l.state) zone) tz
 cross join lateral (
  -- Read each visible assignment once. Slot aggregation must not repeat RLS
  -- checks for every status predicate and every required position.
  with ass as materialized (select x.official_id,x.position_id,x.status,x.published_at,x.assignment_source,x.accept_by
    from public.assignments x where x.game_id=g.id),
  slots as materialized (select p.id from public.sport_positions p where p.sport_id=g.sport_id
    order by p.sort_order,p.id limit greatest(0,coalesce(g.officials_needed,0))),
  slot_stats as (select sp.id,
    count(x.position_id) filter(where x.status<>'declined')>0 filled,
    count(x.position_id) filter(where x.status<>'declined')=0
      and (count(x.position_id) filter(where x.status='declined')>0
        or exists(select 1 from public.audit_history h where h.game_id=g.id and h.action='unassigned' and h.old_data->>'position_id'=sp.id::text)) replacement,
    coalesce(bool_or(x.status='proposed' and x.published_at is not null and x.assignment_source in ('auto_assign','manager') and x.accept_by<p_as_of),false) overdue,
    coalesce(bool_and(x.status in ('accepted','confirmed')) filter(where x.status<>'declined'),true) confirmed,
    coalesce(bool_and(x.published_at is not null) filter(where x.status<>'declined'),true) published
   from slots sp left join ass x on x.position_id=sp.id group by sp.id)
  select (select jsonb_agg(distinct x.official_id) from ass x where x.status<>'declined') official_ids,
   coalesce((select bool_or(x.published_at is null) from ass x where x.status<>'declined'),false) unpublished,
   count(*) slot_count,count(*) filter(where st.filled) filled,
   coalesce(bool_or(st.replacement),false) replacement,coalesce(bool_or(st.overdue),false) overdue,
   coalesce(bool_and(st.confirmed),false) confirmed,coalesce(bool_and(st.published),false) published
  from slot_stats st
 ) a
 where auth.uid() is not null and p_organization_id is not null
  and g.organization_id=p_organization_id and g.archived_at is null
  and (p_game_id is null or g.id=p_game_id)
  and (nullif(p_base_filters->>'leagueId','') is null or g.league_id::text=p_base_filters->>'leagueId')
  and (nullif(p_base_filters->>'levelId','') is null or g.level_id::text=p_base_filters->>'levelId')
  and (not p_base_filters ? 'locationIds' or p_base_filters->'locationIds'='null'::jsonb or p_base_filters->'locationIds' ? g.location_id::text)
  -- Personal official access to a game is not Assignment Center league access.
  -- Mirror the center's explicit grant fence in addition to every table's RLS.
  and (private.can_manage_organization(g.organization_id)
    or private.can_access_organization_league_location(g.organization_id,g.league_id,g.location_id,auth.uid()))
$$;

create or replace function private.assignment_matching_range(p_fact jsonb,p_filter jsonb,p_as_of timestamptz)
returns boolean language plpgsql immutable security invoker set search_path = '' as $$
declare r text:=coalesce(p_filter->>'range','all'); d date:=(p_fact->>'localDate')::date;
 today date:=(p_fact->>'today')::date; start_week date; explicit_filter boolean;
begin
 start_week:=today-(extract(isodow from today)::int-1);
 if r='today' then return d=today; end if;
 if r='tomorrow' then return d=today+1; end if;
 if r='thisWeek' then return d>=start_week and d<start_week+7; end if;
 if r='nextWeek' then return d>=start_week+7 and d<start_week+14; end if;
 if r='custom' then return coalesce(d=nullif(p_filter->>'customDate','')::date,false); end if;
 if r='dateRange' then
  if nullif(p_filter->>'fromDate','') is null and nullif(p_filter->>'toDate','') is null then return false; end if;
  return (nullif(p_filter->>'fromDate','') is null or d>=(p_filter->>'fromDate')::date)
   and (nullif(p_filter->>'toDate','') is null or d<=(p_filter->>'toDate')::date);
 end if;
 explicit_filter:=nullif(p_filter->>'leagueId','') is not null or nullif(p_filter->>'levelId','') is not null
  or nullif(p_filter->>'officialId','') is not null or (p_filter ? 'locationIds' and p_filter->'locationIds'<>'null'::jsonb)
  or coalesce(jsonb_array_length(nullif(p_filter->'days','null'::jsonb)),0)>0
  or coalesce(jsonb_array_length(nullif(p_filter->'times','null'::jsonb)),0)>0
  or coalesce(jsonb_array_length(nullif(p_filter->'completeness','null'::jsonb)),0)>0
  or coalesce((p_filter->>'unpublishedOnly')::boolean,false) or coalesce((p_filter->>'selfAssignOnly')::boolean,false)
  or coalesce((p_filter->>'replacementOnly')::boolean,false);
 if explicit_filter then return true; end if;
 if nullif(p_filter->>'focusGameId','') is not null then return p_fact->>'id'=p_filter->>'focusGameId'; end if;
 return (p_fact->>'startsAt')::timestamptz>=p_as_of;
end $$;

create or replace function private.assignment_matching_predicate(p_fact jsonb,p_filter jsonb,p_as_of timestamptz)
returns boolean language sql immutable security invoker set search_path = '' as $$
 select coalesce(
 private.assignment_matching_range(p_fact,p_filter,p_as_of)
 and (nullif(p_filter->>'leagueId','') is null or p_fact->>'leagueId'=p_filter->>'leagueId')
 and (nullif(p_filter->>'levelId','') is null or p_fact->>'levelId'=p_filter->>'levelId')
 and (nullif(p_filter->>'officialId','') is null or p_fact->'officialIds' ? (p_filter->>'officialId'))
 and (not p_filter ? 'locationIds' or p_filter->'locationIds'='null'::jsonb or p_filter->'locationIds' ? (p_fact->>'locationId'))
 and (coalesce(jsonb_array_length(nullif(p_filter->'days','null'::jsonb)),0)=0 or p_filter->'days' ? (p_fact->>'localDate'))
 and (coalesce(jsonb_array_length(nullif(p_filter->'times','null'::jsonb)),0)=0 or
  (not (p_fact->>'timeTbd')::boolean and p_filter->'times' ? (p_fact->>'localTime')))
 and (not coalesce((p_filter->>'unpublishedOnly')::boolean,false) or (p_fact->>'unpublished')::boolean)
 and (not coalesce((p_filter->>'selfAssignOnly')::boolean,false) or (p_fact->>'selfAssign')::boolean)
 and (not coalesce((p_filter->>'replacementOnly')::boolean,false) or (p_fact->>'replacement')::boolean)
 and (coalesce(jsonb_array_length(nullif(p_filter->'completeness','null'::jsonb)),0)=0 or p_filter->'completeness' ? (p_fact->>'completeness')),false)
$$;

create or replace function public.get_assignment_matching_game_page(p_organization_id uuid,p_filters jsonb default '{}'::jsonb,p_page integer default 1,p_page_size integer default 50)
returns table(game_id uuid) language plpgsql stable security invoker set search_path = '' as $$
declare f jsonb:=private.assignment_matching_validate(p_filters);
 as_of timestamptz:=coalesce(nullif(f->>'asOf','')::timestamptz,now());
 size integer:=least(50,greatest(1,coalesce(p_page_size,50)));
 skip bigint:=(greatest(1,coalesce(p_page,1))::bigint-1)*size;
 matched bigint:=0; emitted integer:=0; candidate record; detail jsonb;
begin
 -- Do not materialize full-organization facts to show the first 50 matches.
 -- The cursor visits candidates in stable order and stops after this page.
 for candidate in select g.id from public.games g
  where auth.uid() is not null and p_organization_id is not null
   and g.organization_id=p_organization_id and g.archived_at is null
   and (private.can_manage_organization(g.organization_id)
    or private.can_access_organization_league_location(g.organization_id,g.league_id,g.location_id,auth.uid()))
   and (nullif(f->>'leagueId','') is null or g.league_id::text=f->>'leagueId')
   and (nullif(f->>'levelId','') is null or g.level_id::text=f->>'levelId')
   and (not f ? 'locationIds' or f->'locationIds'='null'::jsonb or f->'locationIds' ? g.location_id::text)
  order by g.starts_at,g.id loop
  select x.facts into detail from private.assignment_matching_facts(p_organization_id,as_of,candidate.id,f) x;
  if private.assignment_matching_predicate(detail,f,as_of) then
   if matched>=skip then game_id:=candidate.id; return next; emitted:=emitted+1; end if;
   matched:=matched+1;
   exit when emitted>=size;
  end if;
 end loop;
end $$;

create or replace function public.get_assignment_matching_game_totals(p_organization_id uuid,p_filters jsonb default '{}'::jsonb)
returns jsonb language sql stable security invoker set search_path = '' as $$
 with params as materialized (select private.assignment_matching_validate(p_filters) f),
 clock as materialized (select f,coalesce(nullif(f->>'asOf','')::timestamptz,now()) as_of from params),
 facts as materialized (select g.* from clock c cross join lateral private.assignment_matching_facts(p_organization_id,c.as_of,null,c.f) g),
 scenarios as (
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
 ), counts as (
  select s.category,s.key,count(g.game_id) n from scenarios s cross join clock c
  left join facts g on private.assignment_matching_predicate(g.facts,s.f,c.as_of) group by s.category,s.key
 ), groups as (select category,jsonb_object_agg(key,n) value from counts group by category)
 select coalesce((select value from groups where category='total'),'{}'::jsonb)
  || coalesce((select value from groups where category='facets'),'{}'::jsonb)
  || jsonb_build_object('ranges',coalesce((select value from groups where category='ranges'),'{}'::jsonb),
    'completeness',coalesce((select value from groups where category='completeness'),'{}'::jsonb),
    'queue',coalesce((select value from groups where category='queue'),'{}'::jsonb))
$$;

revoke all on function private.assignment_matching_timezone(text) from public,anon;
revoke all on function private.assignment_matching_validate(jsonb) from public,anon;
revoke all on function private.assignment_matching_facts(uuid,timestamptz,uuid,jsonb) from public,anon;
revoke all on function private.assignment_matching_range(jsonb,jsonb,timestamptz) from public,anon;
revoke all on function private.assignment_matching_predicate(jsonb,jsonb,timestamptz) from public,anon;
revoke all on function public.get_assignment_matching_game_page(uuid,jsonb,integer,integer) from public,anon;
revoke all on function public.get_assignment_matching_game_totals(uuid,jsonb) from public,anon;
grant execute on function private.assignment_matching_timezone(text), private.assignment_matching_validate(jsonb),
 private.assignment_matching_facts(uuid,timestamptz,uuid,jsonb),private.assignment_matching_range(jsonb,jsonb,timestamptz),
 private.assignment_matching_predicate(jsonb,jsonb,timestamptz),public.get_assignment_matching_game_page(uuid,jsonb,integer,integer),
 public.get_assignment_matching_game_totals(uuid,jsonb) to authenticated;
