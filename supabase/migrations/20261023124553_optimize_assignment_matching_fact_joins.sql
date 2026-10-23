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

