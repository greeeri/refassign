alter table public.assignments
  add column if not exists assignment_source text not null default 'manager';

alter table public.assignments
  drop constraint if exists assignments_assignment_source_check;

alter table public.assignments
  add constraint assignments_assignment_source_check
  check (assignment_source in ('manager', 'self_assign'));

create table if not exists public.assignment_self_assign_slots (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games(id) on delete cascade,
  position_id uuid not null references public.sport_positions(id) on delete cascade,
  status text not null default 'open' check (status in ('open', 'claimed', 'withdrawn')),
  offered_by uuid not null references auth.users(id),
  offered_at timestamptz not null default now(),
  claimed_by uuid references public.officials(id),
  claimed_at timestamptz,
  unique (game_id, position_id)
);

create index if not exists assignment_self_assign_slots_open_game_idx
  on public.assignment_self_assign_slots (game_id, position_id)
  where status = 'open';

alter table public.assignment_self_assign_slots enable row level security;

drop policy if exists "Managers can view self assign slots" on public.assignment_self_assign_slots;
create policy "Managers can view self assign slots"
on public.assignment_self_assign_slots for select
to authenticated
using ((select public.can_manage_game_setup()));

grant select on public.assignment_self_assign_slots to authenticated;

create or replace function public.set_self_assign_positions(p_slots jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_slot jsonb;
  v_game_id uuid;
  v_position_id uuid;
  v_count integer := 0;
begin
  if not public.can_manage_game_setup() then
    raise exception 'Only Administrators and Assignors can open Self Assign positions';
  end if;

  if jsonb_typeof(p_slots) <> 'array' or jsonb_array_length(p_slots) = 0 then
    raise exception 'Select at least one open position';
  end if;

  for v_slot in select value from jsonb_array_elements(p_slots)
  loop
    v_game_id := (v_slot->>'game_id')::uuid;
    v_position_id := (v_slot->>'position_id')::uuid;

    if not exists (
      select 1
      from public.games g
      join public.sport_positions sp on sp.id = v_position_id and sp.sport_id = g.sport_id
      where g.id = v_game_id
        and g.status in ('active', 'open')
        and (
          select count(*)
          from public.sport_positions preceding
          where preceding.sport_id = g.sport_id
            and (preceding.sort_order, preceding.id) <= (sp.sort_order, sp.id)
        ) <= g.officials_needed
    ) then
      raise exception 'The selected position is not an active assignment slot';
    end if;

    if exists (
      select 1 from public.assignments a
      where a.game_id = v_game_id
        and a.position_id = v_position_id
        and a.status <> 'declined'
    ) then
      raise exception 'A selected position is already assigned';
    end if;

    insert into public.assignment_self_assign_slots
      (game_id, position_id, status, offered_by, offered_at, claimed_by, claimed_at)
    values
      (v_game_id, v_position_id, 'open', auth.uid(), now(), null, null)
    on conflict (game_id, position_id) do update
      set status = 'open', offered_by = excluded.offered_by,
          offered_at = excluded.offered_at, claimed_by = null, claimed_at = null;
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

create or replace function public.withdraw_self_assign_position(
  p_game_id uuid,
  p_position_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.can_manage_game_setup() then
    raise exception 'Only Administrators and Assignors can withdraw Self Assign positions';
  end if;

  update public.assignment_self_assign_slots
  set status = 'withdrawn'
  where game_id = p_game_id and position_id = p_position_id and status = 'open';
end;
$$;

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
      where a.status <> 'declined'
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
    where a.status <> 'declined'
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

create or replace function public.prevent_overlapping_official_assignments()
returns trigger
language plpgsql
set search_path = 'public'
as $$
declare v_start timestamptz; v_end timestamptz;
begin
  if new.assignment_source = 'self_assign' then
    return new;
  end if;
  select starts_at, starts_at + make_interval(mins=>duration_minutes)
    into v_start,v_end from public.games where id=new.game_id;
  if exists(select 1 from public.assignments a join public.games g on g.id=a.game_id where a.official_id=new.official_id and a.id<>new.id and a.status<>'declined' and g.starts_at<v_end and g.starts_at+make_interval(mins=>g.duration_minutes)>v_start) then raise exception 'Official has an overlapping game assignment'; end if;
  if exists(select 1 from public.official_availability_blocks b where b.official_id=new.official_id and b.starts_at is not null and b.ends_at is not null and b.starts_at<v_end and b.ends_at>v_start) then raise exception 'Official has an overlapping time block'; end if;
  return new;
end;
$$;

revoke all on function public.set_self_assign_positions(jsonb) from public, anon;
revoke all on function public.withdraw_self_assign_position(uuid, uuid) from public, anon;
revoke all on function public.list_my_self_assign_positions() from public, anon;
revoke all on function public.claim_self_assign_position(uuid) from public, anon;
grant execute on function public.set_self_assign_positions(jsonb) to authenticated;
grant execute on function public.withdraw_self_assign_position(uuid, uuid) to authenticated;
grant execute on function public.list_my_self_assign_positions() to authenticated;
grant execute on function public.claim_self_assign_position(uuid) to authenticated;
