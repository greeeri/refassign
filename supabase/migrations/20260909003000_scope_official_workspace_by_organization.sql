-- Require an explicit organization for every official-facing operational query.
-- This keeps one login reusable across organizations without mixing their data.

drop function if exists public.my_official_assignments();
create function public.my_official_assignments(p_organization_id uuid)
returns table(
  assignment_id uuid, game_id uuid, game_number text, game_status text,
  position_name text, starts_at timestamptz, home_team text, away_team text,
  location_name text, location_address text, location_city text,
  location_state text, league_name text, level_name text, notes text,
  status text, published_at timestamptz, accept_by timestamptz,
  responded_at timestamptz, decline_reason text, response_token uuid
)
language sql stable security invoker set search_path='' as $$
  select a.id, g.id, g.game_number, g.status, position.name, g.starts_at,
         home.name, away.name, location.name, location.address, location.city,
         location.state, league.name, level.name, g.notes, a.status,
         a.published_at, a.accept_by, a.responded_at, a.decline_reason,
         a.response_token
  from public.assignments a
  join public.officials official on official.id=a.official_id
  join public.games g on g.id=a.game_id
  left join public.teams home on home.id=g.home_team_id
  left join public.teams away on away.id=g.away_team_id
  left join public.locations location on location.id=g.location_id
  left join public.leagues league on league.id=g.league_id
  left join public.levels level on level.id=g.level_id
  left join public.sport_positions position on position.id=a.position_id
  where official.auth_user_id=(select auth.uid())
    and a.published_at is not null
    and g.organization_id=p_organization_id
    and exists (
      select 1 from public.organization_officials organization_official
      where organization_official.organization_id=p_organization_id
        and organization_official.official_id=official.id
        and organization_official.active
    )
  order by g.starts_at;
$$;

drop function if exists public.list_my_self_assign_positions();
create function public.list_my_self_assign_positions(p_organization_id uuid)
returns table (
  slot_id uuid, game_id uuid, game_number text, starts_at timestamptz,
  duration_minutes integer, game_status text, position_id uuid,
  position_name text, league_name text, level_name text, home_team text,
  away_team text, location_name text, location_city text, location_state text
)
language sql stable security definer set search_path='' as $$
  with me as (
    select official.id
    from public.officials official
    join public.organization_officials organization_official
      on organization_official.official_id=official.id
     and organization_official.organization_id=p_organization_id
     and organization_official.active
    where official.auth_user_id=(select auth.uid()) and official.active
    limit 1
  )
  select slot.id, game.id, game.game_number, game.starts_at,
    game.duration_minutes, game.status, position.id, position.name,
    league.name, level.name, home.name, away.name, location.name,
    location.city, location.state
  from me
  join public.assignment_self_assign_slots slot on slot.status='open'
  join public.games game on game.id=slot.game_id
    and game.organization_id=p_organization_id
    and game.status in ('active','open')
  join public.sport_positions position on position.id=slot.position_id
  left join public.leagues league on league.id=game.league_id
  left join public.levels level on level.id=game.level_id
  left join public.teams home on home.id=game.home_team_id
  left join public.teams away on away.id=game.away_team_id
  left join public.locations location on location.id=game.location_id
  where game.starts_at>=now()
    and not exists (
      select 1 from public.assignments assignment
      join public.games assigned_game on assigned_game.id=assignment.game_id
      where assignment.status not in ('declined','cancelled')
        and (
          (assignment.game_id=game.id and assignment.position_id=position.id)
          or (
            assignment.official_id=me.id
            and assigned_game.starts_at < game.starts_at + make_interval(mins=>game.duration_minutes)
            and assigned_game.starts_at + make_interval(mins=>assigned_game.duration_minutes) > game.starts_at
          )
        )
    )
    and (
      game.league_id is null
      or not exists (select 1 from public.official_league_eligibility eligibility where eligibility.official_id=me.id)
      or exists (select 1 from public.official_league_eligibility eligibility where eligibility.official_id=me.id and eligibility.league_id=game.league_id)
    )
    and (
      game.level_id is null
      or not exists (select 1 from public.official_level_eligibility eligibility where eligibility.official_id=me.id)
      or exists (select 1 from public.official_level_eligibility eligibility where eligibility.official_id=me.id and eligibility.level_id=game.level_id)
    )
  order by game.starts_at,position.sort_order;
$$;

drop function if exists public.claim_self_assign_position(uuid);
create function public.claim_self_assign_position(p_slot_id uuid,p_organization_id uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare
  v_official_id uuid;
  v_slot public.assignment_self_assign_slots%rowtype;
  v_game public.games%rowtype;
  v_assignment_id uuid;
begin
  select official.id into v_official_id
  from public.officials official
  join public.organization_officials organization_official
    on organization_official.official_id=official.id
   and organization_official.organization_id=p_organization_id
   and organization_official.active
  where official.auth_user_id=(select auth.uid()) and official.active
  limit 1;
  if v_official_id is null then
    raise exception 'Your official profile is not active in this organization';
  end if;

  select * into v_slot from public.assignment_self_assign_slots
  where id=p_slot_id for update;
  if v_slot.id is null or v_slot.status<>'open' then
    raise exception 'This Self Assign position is no longer available';
  end if;

  select * into v_game from public.games
  where id=v_slot.game_id and organization_id=p_organization_id;
  if v_game.id is null or v_game.status not in ('active','open') or v_game.starts_at<now() then
    raise exception 'This game is not available in the selected organization';
  end if;
  if v_game.league_id is not null
    and exists (select 1 from public.official_league_eligibility eligibility where eligibility.official_id=v_official_id)
    and not exists (select 1 from public.official_league_eligibility eligibility where eligibility.official_id=v_official_id and eligibility.league_id=v_game.league_id) then
    raise exception 'You are not qualified for this league';
  end if;
  if v_game.level_id is not null
    and exists (select 1 from public.official_level_eligibility eligibility where eligibility.official_id=v_official_id)
    and not exists (select 1 from public.official_level_eligibility eligibility where eligibility.official_id=v_official_id and eligibility.level_id=v_game.level_id) then
    raise exception 'You are not qualified for this level';
  end if;
  if exists (
    select 1 from public.assignments assignment
    join public.games assigned_game on assigned_game.id=assignment.game_id
    where assignment.status not in ('declined','cancelled') and (
      (assignment.game_id=v_slot.game_id and assignment.position_id=v_slot.position_id)
      or (assignment.official_id=v_official_id
        and assigned_game.starts_at < v_game.starts_at + make_interval(mins=>v_game.duration_minutes)
        and assigned_game.starts_at + make_interval(mins=>assigned_game.duration_minutes) > v_game.starts_at)
    )
  ) then
    raise exception 'This position is no longer available or you already have a game assignment at that time';
  end if;

  insert into public.assignments (
    game_id,official_id,position_id,status,assigned_at,published_at,
    published_by,response_token,responded_at,assignment_source
  ) values (
    v_slot.game_id,v_official_id,v_slot.position_id,'accepted',now(),now(),
    v_slot.offered_by,gen_random_uuid(),now(),'self_assign'
  ) returning id into v_assignment_id;
  update public.assignment_self_assign_slots
  set status='claimed',claimed_by=v_official_id,claimed_at=now()
  where id=v_slot.id;
  return v_assignment_id;
end;
$$;

drop function if exists public.list_my_mentor_observations();
create function public.list_my_mentor_observations(p_organization_id uuid)
returns table(
  request_id uuid,game_id uuid,game_number text,starts_at timestamptz,duration_minutes integer,
  official_name text,home_name text,away_name text,location_name text,location_address text,
  location_city text,location_state text,league_name text,level_name text,request_details text,
  availability_block_id uuid,field_number text
)
language sql stable security invoker set search_path='' as $$
  select request.id,game.id,game.game_number,coalesce(game.starts_at,request.requested_start_at),
    coalesce(game.duration_minutes,110),referee.full_name,home.name,away.name,
    coalesce(location.name,request.venue_name),location.address,
    coalesce(location.city,request.venue_city),coalesce(location.state,request.venue_state),
    league.name,level.name,request.request_details,request.availability_block_id,request.field_number
  from public.development_mentor_requests request
  join public.officials mentor on mentor.id=request.accepted_by_official_id
  join public.officials referee on referee.id=request.official_id
  join public.games game on game.id=request.game_id and game.organization_id=p_organization_id
  left join public.teams home on home.id=game.home_team_id
  left join public.teams away on away.id=game.away_team_id
  left join public.locations location on location.id=game.location_id
  left join public.leagues league on league.id=game.league_id
  left join public.levels level on level.id=game.level_id
  where mentor.auth_user_id=(select auth.uid()) and request.status='assigned'
    and exists (
      select 1 from public.organization_officials organization_official
      where organization_official.organization_id=p_organization_id
        and organization_official.official_id=mentor.id
        and organization_official.active
    )
  order by game.starts_at;
$$;

revoke all on function public.my_official_assignments(uuid) from public,anon;
revoke all on function public.list_my_self_assign_positions(uuid) from public,anon;
revoke all on function public.claim_self_assign_position(uuid,uuid) from public,anon;
revoke all on function public.list_my_mentor_observations(uuid) from public,anon;
grant execute on function public.my_official_assignments(uuid) to authenticated;
grant execute on function public.list_my_self_assign_positions(uuid) to authenticated;
grant execute on function public.claim_self_assign_position(uuid,uuid) to authenticated;
grant execute on function public.list_my_mentor_observations(uuid) to authenticated;

notify pgrst,'reload schema';
