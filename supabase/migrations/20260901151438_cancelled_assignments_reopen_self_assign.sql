create or replace function public.list_my_self_assign_positions()
returns table (
  slot_id uuid,
  game_id uuid,
  game_number text,
  starts_at timestamptz,
  duration_minutes integer,
  game_status text,
  position_id uuid,
  position_name text,
  league_name text,
  level_name text,
  home_team text,
  away_team text,
  location_name text,
  location_city text,
  location_state text
)
language sql
stable
security definer
set search_path = ''
as $$
  with me as (
    select o.id
    from public.officials o
    where o.auth_user_id = auth.uid() and o.active
    limit 1
  )
  select
    s.id, g.id, g.game_number, g.starts_at, g.duration_minutes, g.status,
    sp.id, sp.name, l.name, lv.name, ht.name, at.name,
    loc.name, loc.city, loc.state
  from me
  join public.assignment_self_assign_slots s on s.status = 'open'
  join public.games g on g.id = s.game_id and g.status in ('active', 'open')
  join public.sport_positions sp on sp.id = s.position_id
  left join public.leagues l on l.id = g.league_id
  left join public.levels lv on lv.id = g.level_id
  left join public.teams ht on ht.id = g.home_team_id
  left join public.teams at on at.id = g.away_team_id
  left join public.locations loc on loc.id = g.location_id
  where g.starts_at >= now()
    and not exists (
      select 1
      from public.assignments a
      join public.games assigned_game on assigned_game.id = a.game_id
      where a.status not in ('declined','cancelled')
        and (
          (a.game_id = g.id and a.position_id = sp.id)
          or (
            a.official_id = me.id
            and assigned_game.starts_at < g.starts_at + make_interval(mins => g.duration_minutes)
            and assigned_game.starts_at + make_interval(mins => assigned_game.duration_minutes) > g.starts_at
          )
        )
    )
    and (
      g.league_id is null
      or not exists (select 1 from public.official_league_eligibility e where e.official_id = me.id)
      or exists (select 1 from public.official_league_eligibility e where e.official_id = me.id and e.league_id = g.league_id)
    )
    and (
      g.level_id is null
      or not exists (select 1 from public.official_level_eligibility e where e.official_id = me.id)
      or exists (select 1 from public.official_level_eligibility e where e.official_id = me.id and e.level_id = g.level_id)
    )
  order by g.starts_at, sp.sort_order;
$$;

create or replace function public.claim_self_assign_position(p_slot_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_official_id uuid;
  v_slot public.assignment_self_assign_slots%rowtype;
  v_game public.games%rowtype;
  v_assignment_id uuid;
begin
  select o.id into v_official_id
  from public.officials o
  where o.auth_user_id = auth.uid() and o.active
  limit 1;

  if v_official_id is null then
    raise exception 'Your login is not linked to an active official record';
  end if;

  select * into v_slot
  from public.assignment_self_assign_slots
  where id = p_slot_id
  for update;

  if v_slot.id is null or v_slot.status <> 'open' then
    raise exception 'This Self Assign position is no longer available';
  end if;

  select * into v_game from public.games where id = v_slot.game_id;
  if v_game.id is null or v_game.status not in ('active', 'open') or v_game.starts_at < now() then
    raise exception 'This game is no longer available for Self Assign';
  end if;

  if v_game.league_id is not null
     and exists (select 1 from public.official_league_eligibility e where e.official_id = v_official_id)
     and not exists (select 1 from public.official_league_eligibility e where e.official_id = v_official_id and e.league_id = v_game.league_id) then
    raise exception 'You are not qualified for this league';
  end if;

  if v_game.level_id is not null
     and exists (select 1 from public.official_level_eligibility e where e.official_id = v_official_id)
     and not exists (select 1 from public.official_level_eligibility e where e.official_id = v_official_id and e.level_id = v_game.level_id) then
    raise exception 'You are not qualified for this level';
  end if;

  if exists (
    select 1
    from public.assignments a
    join public.games assigned_game on assigned_game.id = a.game_id
    where a.status not in ('declined','cancelled')
      and (
        (a.game_id = v_slot.game_id and a.position_id = v_slot.position_id)
        or (
          a.official_id = v_official_id
          and assigned_game.starts_at < v_game.starts_at + make_interval(mins => v_game.duration_minutes)
          and assigned_game.starts_at + make_interval(mins => assigned_game.duration_minutes) > v_game.starts_at
        )
      )
  ) then
    raise exception 'This position is no longer available or you already have a game assignment at that time';
  end if;

  insert into public.assignments (
    game_id, official_id, position_id, status, assigned_at, published_at,
    published_by, response_token, responded_at, assignment_source
  ) values (
    v_slot.game_id, v_official_id, v_slot.position_id, 'accepted', now(), now(),
    v_slot.offered_by, gen_random_uuid(), now(), 'self_assign'
  ) returning id into v_assignment_id;

  update public.assignment_self_assign_slots
  set status = 'claimed', claimed_by = v_official_id, claimed_at = now()
  where id = v_slot.id;

  return v_assignment_id;
end;
$$;


