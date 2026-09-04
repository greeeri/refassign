alter table public.development_mentor_requests
  add column if not exists game_id uuid references public.games(id) on delete cascade,
  add column if not exists request_details text,
  add column if not exists accepted_by_official_id uuid references public.officials(id) on delete set null,
  add column if not exists accepted_at timestamptz,
  add column if not exists availability_block_id uuid references public.official_availability_blocks(id) on delete set null;

alter table public.development_mentor_requests
  drop constraint if exists development_mentor_requests_request_details_check;
alter table public.development_mentor_requests
  add constraint development_mentor_requests_request_details_check
  check (request_details is null or length(trim(request_details)) <= 5000);

drop index if exists public.development_mentor_requests_one_pending_idx;
create unique index if not exists development_mentor_requests_one_pending_game_idx
  on public.development_mentor_requests(program_id, official_id, game_id)
  where status = 'pending' and game_id is not null;
create unique index if not exists development_mentor_requests_one_pending_legacy_idx
  on public.development_mentor_requests(program_id, official_id)
  where status = 'pending' and game_id is null;
create index if not exists development_mentor_requests_game_idx
  on public.development_mentor_requests(game_id, status);
create index if not exists development_mentor_requests_accepted_mentor_idx
  on public.development_mentor_requests(accepted_by_official_id, accepted_at)
  where status = 'assigned';

drop policy if exists "Officials request mentors" on public.development_mentor_requests;
create policy "Officials request mentors" on public.development_mentor_requests
for insert to authenticated
with check (
  exists (
    select 1
    from public.officials official
    join public.registration_program_officials membership on membership.official_id = official.id
    join public.assignments assignment on assignment.official_id = official.id
    join public.games game on game.id = assignment.game_id
    where official.id = development_mentor_requests.official_id
      and official.auth_user_id = (select auth.uid())
      and membership.program_id = development_mentor_requests.program_id
      and assignment.game_id = development_mentor_requests.game_id
      and assignment.status in ('accepted', 'confirmed')
      and game.starts_at >= now()
      and game.status not in ('canceled', 'cancelled', 'rained_out')
  )
);

create or replace function public.list_iowa_development_mentor_requests()
returns table(
  request_id uuid,
  official_id uuid,
  official_name text,
  status text,
  requested_at timestamptz,
  request_details text,
  game_id uuid,
  game_number text,
  starts_at timestamptz,
  duration_minutes integer,
  home_name text,
  away_name text,
  location_name text,
  location_address text,
  location_city text,
  location_state text,
  league_name text,
  level_name text,
  accepted_by_official_id uuid,
  accepted_mentor_name text,
  accepted_at timestamptz
)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.can_access_iowa_development_records() then
    raise exception 'Not authorized';
  end if;
  return query
  select request.id, request.official_id, official.full_name, request.status,
    request.requested_at, request.request_details, game.id, game.game_number,
    game.starts_at, game.duration_minutes, home.name, away.name, location.name,
    location.address, location.city, location.state, league.name, level.name,
    request.accepted_by_official_id, mentor.full_name, request.accepted_at
  from public.development_mentor_requests request
  join public.registration_programs program on program.id = request.program_id
  join public.officials official on official.id = request.official_id
  left join public.games game on game.id = request.game_id
  left join public.teams home on home.id = game.home_team_id
  left join public.teams away on away.id = game.away_team_id
  left join public.locations location on location.id = game.location_id
  left join public.leagues league on league.id = game.league_id
  left join public.levels level on level.id = game.level_id
  left join public.officials mentor on mentor.id = request.accepted_by_official_id
  where program.slug = 'iowa-soccer'
  order by request.requested_at desc;
end;
$$;
revoke all on function public.list_iowa_development_mentor_requests() from public, anon;
grant execute on function public.list_iowa_development_mentor_requests() to authenticated;

create or replace function public.accept_iowa_development_mentor_request(p_request_id uuid)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_request public.development_mentor_requests%rowtype;
  v_game public.games%rowtype;
  v_mentor_id uuid;
  v_mentor_name text;
  v_block_id uuid;
  v_ends_at timestamptz;
begin
  select official.id, official.full_name
  into v_mentor_id, v_mentor_name
  from public.development_mentors mentor
  join public.registration_programs program on program.id = mentor.program_id
  join public.officials official on official.id = mentor.official_id
  where program.slug = 'iowa-soccer'
    and program.active = true
    and official.active = true
    and official.auth_user_id = (select auth.uid());

  if v_mentor_id is null then raise exception 'Only an active Iowa Soccer mentor can accept this request'; end if;

  select * into v_request
  from public.development_mentor_requests
  where id = p_request_id
  for update;

  if v_request.id is null then raise exception 'Mentor request not found'; end if;
  if v_request.status <> 'pending' then raise exception 'This mentor request has already been accepted'; end if;
  if v_request.game_id is null then raise exception 'This request does not have a game selected'; end if;
  if v_request.official_id = v_mentor_id then raise exception 'You cannot mentor your own game'; end if;

  select * into v_game from public.games where id = v_request.game_id;
  if v_game.id is null or v_game.starts_at < now() or v_game.status in ('canceled', 'cancelled', 'rained_out') then
    raise exception 'This game is no longer available for mentoring';
  end if;
  v_ends_at := v_game.starts_at + make_interval(mins => coalesce(v_game.duration_minutes, 110));

  if exists (
    select 1 from public.assignments assignment
    join public.games assigned_game on assigned_game.id = assignment.game_id
    where assignment.official_id = v_mentor_id
      and assignment.status not in ('declined', 'cancelled')
      and assigned_game.starts_at < v_ends_at
      and assigned_game.starts_at + make_interval(mins => coalesce(assigned_game.duration_minutes, 110)) > v_game.starts_at
  ) then raise exception 'You already have a game assignment during this time'; end if;

  if exists (
    select 1 from public.official_availability_blocks block
    where block.official_id = v_mentor_id
      and block.block_type = 'time'
      and block.starts_at < v_ends_at
      and block.ends_at > v_game.starts_at
  ) then raise exception 'You already have an availability block during this time'; end if;

  insert into public.official_availability_blocks(
    official_id, block_type, starts_at, ends_at, notes, created_by
  ) values (
    v_mentor_id, 'time', v_game.starts_at, v_ends_at,
    'Mentor observation: Game ' || coalesce(v_game.game_number, v_game.id::text),
    (select auth.uid())
  ) returning id into v_block_id;

  update public.development_mentor_requests
  set status = 'assigned', handled_by = (select auth.uid()),
    accepted_by_official_id = v_mentor_id, accepted_at = now(),
    responded_at = now(), availability_block_id = v_block_id,
    response = coalesce(v_mentor_name, 'An Iowa Soccer mentor') || ' accepted this mentor request.'
  where id = p_request_id;
  return p_request_id;
end;
$$;
revoke all on function public.accept_iowa_development_mentor_request(uuid) from public, anon;
grant execute on function public.accept_iowa_development_mentor_request(uuid) to authenticated;

create or replace function public.list_my_mentor_observations()
returns table(
  request_id uuid,
  game_id uuid,
  game_number text,
  starts_at timestamptz,
  duration_minutes integer,
  official_name text,
  home_name text,
  away_name text,
  location_name text,
  location_address text,
  location_city text,
  location_state text,
  league_name text,
  level_name text,
  request_details text,
  availability_block_id uuid
)
language sql stable security invoker set search_path = '' as $$
  select request.id, game.id, game.game_number, game.starts_at, game.duration_minutes,
    referee.full_name, home.name, away.name, location.name, location.address,
    location.city, location.state, league.name, level.name, request.request_details,
    request.availability_block_id
  from public.development_mentor_requests request
  join public.officials mentor on mentor.id = request.accepted_by_official_id
  join public.officials referee on referee.id = request.official_id
  join public.games game on game.id = request.game_id
  left join public.teams home on home.id = game.home_team_id
  left join public.teams away on away.id = game.away_team_id
  left join public.locations location on location.id = game.location_id
  left join public.leagues league on league.id = game.league_id
  left join public.levels level on level.id = game.level_id
  where mentor.auth_user_id = (select auth.uid())
    and request.status = 'assigned'
  order by game.starts_at;
$$;
revoke all on function public.list_my_mentor_observations() from public, anon;
grant execute on function public.list_my_mentor_observations() to authenticated;
