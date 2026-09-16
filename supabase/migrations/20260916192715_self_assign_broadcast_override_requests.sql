create table public.self_assign_override_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  slot_id uuid not null references public.assignment_self_assign_slots(id) on delete cascade,
  official_id uuid not null references public.officials(id) on delete cascade,
  eligibility_reason text not null,
  status text not null default 'pending' check (status in ('pending','approved','denied','withdrawn')),
  requested_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id) on delete set null,
  unique(slot_id,official_id)
);
create index self_assign_override_requests_manager_idx
  on public.self_assign_override_requests(organization_id,status,requested_at desc);
alter table public.self_assign_override_requests enable row level security;

create policy "Officials read their override requests" on public.self_assign_override_requests
for select to authenticated using (exists(
  select 1 from public.officials official
  where official.id=official_id and official.auth_user_id=(select auth.uid())
));
create policy "Managers read override requests" on public.self_assign_override_requests
for select to authenticated using (exists(
  select 1 from public.assignment_self_assign_slots slot
  join public.games game on game.id=slot.game_id
  where slot.id=slot_id and private.can_manage_organization_league(
    game.organization_id,game.league_id,(select auth.uid())
  )
));
grant select on public.self_assign_override_requests to authenticated,service_role;

create or replace function public.list_my_self_assign_opportunities(p_organization_id uuid)
returns table(
  slot_id uuid,game_id uuid,game_number text,starts_at timestamptz,duration_minutes integer,
  game_status text,position_id uuid,position_name text,league_name text,level_name text,
  home_team text,away_team text,location_name text,location_city text,location_state text,
  eligible boolean,eligibility_reason text,request_status text
)
language sql stable security definer set search_path='' as $$
with me as (
  select official.id
  from public.officials official
  join public.organization_officials link on link.official_id=official.id
    and link.organization_id=p_organization_id and link.active
  where official.auth_user_id=(select auth.uid()) and official.active limit 1
), opportunities as (
  select slot.id slot_id,game.*,position.id position_id,position.name position_name,
    league.name league_name,level.name level_name,home.name home_team,away.name away_team,
    location.name location_name,location.city location_city,location.state location_state,
    not exists(
      select 1 from public.assignments assignment
      join public.games other_game on other_game.id=assignment.game_id
      where assignment.official_id=me.id and assignment.status not in ('declined','cancelled','canceled')
        and lower(coalesce(other_game.status,'open')) not in ('cancelled','canceled','rained_out','rain out')
        and other_game.starts_at < game.starts_at+make_interval(mins=>coalesce(game.duration_minutes,110))
        and other_game.starts_at+make_interval(mins=>coalesce(other_game.duration_minutes,110)) > game.starts_at
    ) conflict_free,
    (game.league_id is null or exists(select 1 from public.official_league_eligibility e where e.official_id=me.id and e.league_id=game.league_id)) league_ok,
    (game.level_id is null or exists(select 1 from public.official_level_eligibility e where e.official_id=me.id and e.level_id=game.level_id)) level_ok,
    me.id official_id
  from me
  join public.assignment_self_assign_slots slot on slot.status='open'
  join public.games game on game.id=slot.game_id and game.organization_id=p_organization_id
    and game.status in ('active','open') and game.starts_at>=now()
  join public.sport_positions position on position.id=slot.position_id
  left join public.leagues league on league.id=game.league_id
  left join public.levels level on level.id=game.level_id
  left join public.teams home on home.id=game.home_team_id
  left join public.teams away on away.id=game.away_team_id
  left join public.locations location on location.id=game.location_id
  where not exists(select 1 from public.assignments a where a.game_id=game.id and a.position_id=position.id and a.status not in ('declined','cancelled','canceled'))
)
select opportunity.slot_id,opportunity.id,opportunity.game_number,opportunity.starts_at,
  opportunity.duration_minutes,opportunity.status,opportunity.position_id,opportunity.position_name,
  opportunity.league_name,opportunity.level_name,opportunity.home_team,opportunity.away_team,
  opportunity.location_name,opportunity.location_city,opportunity.location_state,
  opportunity.conflict_free and opportunity.league_ok and opportunity.level_ok,
  case when not opportunity.conflict_free then 'Schedule conflict'
       when not opportunity.league_ok and not opportunity.level_ok then 'League and level eligibility required'
       when not opportunity.league_ok then 'League eligibility required'
       when not opportunity.level_ok then 'Level eligibility required' else null end,
  request.status
from opportunities opportunity
left join public.self_assign_override_requests request
  on request.slot_id=opportunity.slot_id and request.official_id=opportunity.official_id
order by opportunity.starts_at,opportunity.position_name;
$$;

create or replace function public.request_self_assign_override(p_slot_id uuid,p_organization_id uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_official uuid;v_game public.games%rowtype;v_slot public.assignment_self_assign_slots%rowtype;
  v_reason text;v_id uuid;
begin
  select official.id into v_official from public.officials official
  join public.organization_officials link on link.official_id=official.id
    and link.organization_id=p_organization_id and link.active
  where official.auth_user_id=(select auth.uid()) and official.active limit 1;
  if v_official is null then raise exception 'Your official profile is not active in this organization'; end if;
  select * into v_slot from public.assignment_self_assign_slots where id=p_slot_id and status='open';
  select * into v_game from public.games where id=v_slot.game_id and organization_id=p_organization_id;
  if v_game.id is null then raise exception 'This position is no longer available'; end if;
  if exists(select 1 from public.assignments a join public.games g on g.id=a.game_id
    where a.official_id=v_official and a.status not in ('declined','cancelled','canceled')
    and g.starts_at<v_game.starts_at+make_interval(mins=>coalesce(v_game.duration_minutes,110))
    and g.starts_at+make_interval(mins=>coalesce(g.duration_minutes,110))>v_game.starts_at)
  then raise exception 'Schedule conflicts cannot be overridden'; end if;
  if v_game.league_id is not null and not exists(select 1 from public.official_league_eligibility e where e.official_id=v_official and e.league_id=v_game.league_id) then v_reason='League eligibility required'; end if;
  if v_game.level_id is not null and not exists(select 1 from public.official_level_eligibility e where e.official_id=v_official and e.level_id=v_game.level_id) then v_reason=concat_ws(' and ',v_reason,'Level eligibility required'); end if;
  if v_reason is null then raise exception 'You are eligible and can self assign this position'; end if;
  insert into public.self_assign_override_requests(organization_id,slot_id,official_id,eligibility_reason)
  values(p_organization_id,p_slot_id,v_official,v_reason)
  on conflict(slot_id,official_id) do update set status='pending',eligibility_reason=excluded.eligibility_reason,requested_at=now(),reviewed_at=null,reviewed_by=null
  returning id into v_id;
  return v_id;
end;$$;

create or replace function public.review_self_assign_override(p_request_id uuid,p_approve boolean)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_request public.self_assign_override_requests%rowtype;v_slot public.assignment_self_assign_slots%rowtype;
  v_game public.games%rowtype;v_assignment uuid;
begin
  select * into v_request from public.self_assign_override_requests where id=p_request_id and status='pending' for update;
  select * into v_slot from public.assignment_self_assign_slots where id=v_request.slot_id for update;
  select * into v_game from public.games where id=v_slot.game_id;
  if v_request.id is null or not private.can_manage_organization_league(v_request.organization_id,v_game.league_id,(select auth.uid())) then raise exception 'Not authorized'; end if;
  if not p_approve then update public.self_assign_override_requests set status='denied',reviewed_at=now(),reviewed_by=(select auth.uid()) where id=p_request_id; return null; end if;
  if v_slot.status<>'open' then raise exception 'This position is no longer available'; end if;
  insert into public.assignments(game_id,official_id,position_id,status,assigned_at,published_at,published_by,response_token,responded_at,assignment_source)
  values(v_slot.game_id,v_request.official_id,v_slot.position_id,'accepted',now(),now(),(select auth.uid()),gen_random_uuid(),now(),'self_assign') returning id into v_assignment;
  update public.assignment_self_assign_slots set status='claimed',claimed_by=v_request.official_id,claimed_at=now() where id=v_slot.id;
  update public.self_assign_override_requests set status='approved',reviewed_at=now(),reviewed_by=(select auth.uid()) where id=p_request_id;
  update public.self_assign_override_requests set status='denied',reviewed_at=now(),reviewed_by=(select auth.uid()) where slot_id=v_slot.id and id<>p_request_id and status='pending';
  return v_assignment;
end;$$;

revoke all on function public.list_my_self_assign_opportunities(uuid) from public,anon;
revoke all on function public.request_self_assign_override(uuid,uuid) from public,anon;
revoke all on function public.review_self_assign_override(uuid,boolean) from public,anon;
grant execute on function public.list_my_self_assign_opportunities(uuid) to authenticated;
grant execute on function public.request_self_assign_override(uuid,uuid) to authenticated;
grant execute on function public.review_self_assign_override(uuid,boolean) to authenticated;
notify pgrst,'reload schema';
