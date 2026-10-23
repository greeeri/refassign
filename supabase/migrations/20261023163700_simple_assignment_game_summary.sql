-- Two counts only. Ordinary filters never read audit history or matching facts.
create or replace function public.get_assignment_game_summary(p_organization_id uuid,p_filters jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare f jsonb:=private.assignment_matching_validate(p_filters);
 as_of timestamptz:=coalesce(nullif(f->>'asOf','')::timestamptz,now());
 is_owner boolean:=private.can_manage_organization(p_organization_id);
 history_filter boolean:=coalesce((f->>'replacementOnly')::boolean,false)
  or coalesce(jsonb_array_length(nullif(f->'completeness','null'::jsonb)),0)>0;
 today_forward boolean:=coalesce((f->>'todayForward')::boolean,false) and coalesce(f->>'range','all')='all'
  and coalesce(jsonb_array_length(nullif(f->'days','null'::jsonb)),0)=0 and nullif(f->>'focusGameId','') is null;
 matching_ids uuid[]; result jsonb;
begin
 -- Existing assignment-status classifications can depend on unassignment history.
 -- Retain that meaning only when the user explicitly selects such a filter.
 if history_filter then
  select coalesce(array_agg(x.game_id),'{}'::uuid[]) into matching_ids
  from private.assignment_matching_facts(p_organization_id,as_of,null,f) x
  where private.assignment_matching_predicate(x.facts,f,as_of)
   and (not today_forward or (x.facts->>'localDate')::date>=(x.facts->>'today')::date);
 end if;
 with games as materialized (
  select g.id,g.starts_at,g.league_id,g.level_id,g.location_id,g.sport_id,g.officials_needed,g.time_tbd
  from public.games g
  where (select auth.uid()) is not null and p_organization_id is not null
   and g.organization_id=p_organization_id and g.archived_at is null
   and (matching_ids is null or g.id=any(matching_ids))
   and (not today_forward or g.starts_at>=as_of-interval '26 hours')
   and (is_owner or private.can_access_organization_league_location(g.organization_id,g.league_id,g.location_id,(select auth.uid())))
   and (nullif(f->>'leagueId','') is null or g.league_id::text=f->>'leagueId')
   and (nullif(f->>'levelId','') is null or g.level_id::text=f->>'levelId')
   and (not f ? 'locationIds' or f->'locationIds'='null'::jsonb or f->'locationIds' ? g.location_id::text)
 ), locations as materialized (
  select l.id,private.assignment_matching_timezone(l.state) zone from public.locations l
  where l.id in(select g.location_id from games g)
 ), dated as materialized (
  select g.*,coalesce(l.zone,'America/Chicago') zone from games g left join locations l on l.id=g.location_id
 ), selected_games as materialized (
  select g.* from dated g where history_filter or (
   (case when today_forward then (g.starts_at at time zone g.zone)::date>=(as_of at time zone g.zone)::date
    else private.assignment_matching_range(jsonb_build_object('id',g.id,'startsAt',g.starts_at,
     'localDate',to_char(g.starts_at at time zone g.zone,'YYYY-MM-DD'),
     'today',to_char(as_of at time zone g.zone,'YYYY-MM-DD')),f,as_of) end)
   and (coalesce(jsonb_array_length(nullif(f->'days','null'::jsonb)),0)=0 or f->'days' ? to_char(g.starts_at at time zone g.zone,'YYYY-MM-DD'))
   and (coalesce(jsonb_array_length(nullif(f->'times','null'::jsonb)),0)=0 or
    (not coalesce(g.time_tbd,false) and f->'times' ? to_char(g.starts_at at time zone g.zone,'HH24:MI')))
  )
 ), positions as materialized (
  select p.id,p.sport_id,row_number() over(partition by p.sport_id order by p.sort_order,p.id) ordinal
  from public.sport_positions p where p.sport_id in(select g.sport_id from selected_games g)
 ), assignments as materialized (
  select a.game_id,a.position_id,a.official_id,a.published_at from public.assignments a
  where a.status<>'declined' and a.game_id in(select g.id from selected_games g)
 ), staffing as materialized (
  select g.id,count(distinct p.id) needed,count(distinct p.id) filter(where a.position_id is not null) filled
  from selected_games g left join positions p on p.sport_id=g.sport_id and p.ordinal<=greatest(0,coalesce(g.officials_needed,0))
  left join assignments a on a.game_id=g.id and a.position_id=p.id group by g.id
 )
 select jsonb_build_object('total',count(*),'openGames',count(*) filter(where st.filled<st.needed)) into result
 from selected_games g join staffing st on st.id=g.id
 where history_filter or (
  (nullif(f->>'officialId','') is null or exists(select 1 from assignments a where a.game_id=g.id and a.official_id::text=f->>'officialId'))
  and (not coalesce((f->>'unpublishedOnly')::boolean,false) or exists(select 1 from assignments a where a.game_id=g.id and a.published_at is null))
  and case when coalesce((f->>'selfAssignOnly')::boolean,false) then exists(
   select 1 from public.assignment_self_assign_slots s where s.game_id=g.id and s.status='open') else true end
 );
 return result;
end $$;
revoke all on function public.get_assignment_game_summary(uuid,jsonb) from public,anon;
grant execute on function public.get_assignment_game_summary(uuid,jsonb) to authenticated;
