alter table public.development_mentor_requests
  add column if not exists requested_start_at timestamptz,
  add column if not exists venue_name text,
  add column if not exists venue_city text,
  add column if not exists venue_state text,
  add column if not exists field_number text;

alter table public.development_mentor_requests
  drop constraint if exists development_mentor_requests_manual_details_check;
alter table public.development_mentor_requests
  add constraint development_mentor_requests_manual_details_check check(
    game_id is not null or status <> 'pending' or (
      requested_start_at is not null
      and length(trim(coalesce(venue_name,''))) between 1 and 200
      and length(trim(coalesce(venue_city,''))) between 1 and 120
      and length(trim(coalesce(venue_state,''))) between 2 and 50
      and length(trim(coalesce(field_number,''))) between 1 and 100
    )
  );

drop policy if exists "Officials request mentors" on public.development_mentor_requests;
create policy "Officials request mentors" on public.development_mentor_requests
for insert to authenticated with check(
  exists(
    select 1 from public.officials official
    join public.registration_program_officials membership on membership.official_id=official.id
    where official.id=development_mentor_requests.official_id
      and official.auth_user_id=(select auth.uid())
      and membership.program_id=development_mentor_requests.program_id
  )
  and (
    (
      development_mentor_requests.game_id is null
      and development_mentor_requests.requested_start_at>=now()
      and length(trim(coalesce(development_mentor_requests.venue_name,'')))>0
      and length(trim(coalesce(development_mentor_requests.venue_city,'')))>0
      and length(trim(coalesce(development_mentor_requests.venue_state,'')))>=2
      and length(trim(coalesce(development_mentor_requests.field_number,'')))>0
    )
    or exists(
      select 1 from public.assignments assignment
      join public.games game on game.id=assignment.game_id
      where assignment.official_id=development_mentor_requests.official_id
        and assignment.game_id=development_mentor_requests.game_id
        and assignment.status in ('accepted','confirmed')
        and game.starts_at>=now()
        and game.status not in ('canceled','cancelled','rained_out')
    )
  )
);

drop function if exists public.list_iowa_development_mentor_requests();
create function public.list_iowa_development_mentor_requests()
returns table(
  request_id uuid,official_id uuid,official_name text,status text,requested_at timestamptz,
  request_details text,game_id uuid,game_number text,starts_at timestamptz,duration_minutes integer,
  home_name text,away_name text,location_name text,location_address text,location_city text,
  location_state text,league_name text,level_name text,accepted_by_official_id uuid,
  accepted_mentor_name text,accepted_at timestamptz,field_number text
)
language plpgsql stable security definer set search_path='' as $$
begin
  if not public.can_access_iowa_development_records() then raise exception 'Not authorized';end if;
  return query
  select request.id,request.official_id,official.full_name,request.status,request.requested_at,
    request.request_details,game.id,game.game_number,coalesce(game.starts_at,request.requested_start_at),
    coalesce(game.duration_minutes,110),home.name,away.name,
    coalesce(location.name,request.venue_name),location.address,
    coalesce(location.city,request.venue_city),coalesce(location.state,request.venue_state),
    league.name,level.name,request.accepted_by_official_id,mentor.full_name,request.accepted_at,
    request.field_number
  from public.development_mentor_requests request
  join public.registration_programs program on program.id=request.program_id
  join public.officials official on official.id=request.official_id
  left join public.games game on game.id=request.game_id
  left join public.teams home on home.id=game.home_team_id
  left join public.teams away on away.id=game.away_team_id
  left join public.locations location on location.id=game.location_id
  left join public.leagues league on league.id=game.league_id
  left join public.levels level on level.id=game.level_id
  left join public.officials mentor on mentor.id=request.accepted_by_official_id
  where program.slug='iowa-soccer'
  order by request.requested_at desc;
end;
$$;
revoke all on function public.list_iowa_development_mentor_requests() from public,anon;
grant execute on function public.list_iowa_development_mentor_requests() to authenticated;

create or replace function public.accept_iowa_development_mentor_request(p_request_id uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare
  v_request public.development_mentor_requests%rowtype;
  v_game public.games%rowtype;
  v_mentor_id uuid;
  v_mentor_name text;
  v_block_id uuid;
  v_starts_at timestamptz;
  v_ends_at timestamptz;
  v_label text;
begin
  select official.id,official.full_name into v_mentor_id,v_mentor_name
  from public.development_mentors mentor
  join public.registration_programs program on program.id=mentor.program_id
  join public.officials official on official.id=mentor.official_id
  where program.slug='iowa-soccer' and program.active=true and official.active=true
    and official.auth_user_id=(select auth.uid());
  if v_mentor_id is null then raise exception 'Only an active Iowa Soccer mentor can accept this request';end if;

  select * into v_request from public.development_mentor_requests where id=p_request_id for update;
  if v_request.id is null then raise exception 'Mentor request not found';end if;
  if v_request.status<>'pending' then raise exception 'This mentor request has already been accepted';end if;
  if v_request.official_id=v_mentor_id then raise exception 'You cannot mentor your own game';end if;

  if v_request.game_id is not null then
    select * into v_game from public.games where id=v_request.game_id;
    if v_game.id is null or v_game.starts_at<now() or v_game.status in ('canceled','cancelled','rained_out') then raise exception 'This game is no longer available for mentoring';end if;
    v_starts_at:=v_game.starts_at;
    v_ends_at:=v_game.starts_at+make_interval(mins=>coalesce(v_game.duration_minutes,110));
    v_label:='Game '||coalesce(v_game.game_number,v_game.id::text);
  else
    v_starts_at:=v_request.requested_start_at;
    v_ends_at:=v_request.requested_start_at+make_interval(mins=>110);
    v_label:=coalesce(v_request.venue_name,'Manual mentor visit')||' — Field '||coalesce(v_request.field_number,'N/A');
    if v_starts_at is null or v_starts_at<now() then raise exception 'This requested date and time is no longer available';end if;
  end if;

  if exists(
    select 1 from public.assignments assignment join public.games assigned_game on assigned_game.id=assignment.game_id
    where assignment.official_id=v_mentor_id and assignment.status not in ('declined','cancelled')
      and assigned_game.starts_at<v_ends_at
      and assigned_game.starts_at+make_interval(mins=>coalesce(assigned_game.duration_minutes,110))>v_starts_at
  ) then raise exception 'You already have a game assignment during this time';end if;
  if exists(
    select 1 from public.official_availability_blocks block
    where block.official_id=v_mentor_id and block.block_type='time'
      and block.starts_at<v_ends_at and block.ends_at>v_starts_at
  ) then raise exception 'You already have an availability block during this time';end if;

  insert into public.official_availability_blocks(official_id,block_type,starts_at,ends_at,notes,created_by)
  values(v_mentor_id,'time',v_starts_at,v_ends_at,'Mentor observation: '||v_label,(select auth.uid()))
  returning id into v_block_id;
  update public.development_mentor_requests set status='assigned',handled_by=(select auth.uid()),
    accepted_by_official_id=v_mentor_id,accepted_at=now(),responded_at=now(),availability_block_id=v_block_id,
    response=coalesce(v_mentor_name,'An Iowa Soccer mentor')||' accepted this mentor request.'
  where id=p_request_id;
  return p_request_id;
end;
$$;
revoke all on function public.accept_iowa_development_mentor_request(uuid) from public,anon;
grant execute on function public.accept_iowa_development_mentor_request(uuid) to authenticated;

drop function if exists public.list_my_mentor_observations();
create function public.list_my_mentor_observations()
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
  left join public.games game on game.id=request.game_id
  left join public.teams home on home.id=game.home_team_id
  left join public.teams away on away.id=game.away_team_id
  left join public.locations location on location.id=game.location_id
  left join public.leagues league on league.id=game.league_id
  left join public.levels level on level.id=game.level_id
  where mentor.auth_user_id=(select auth.uid()) and request.status='assigned'
  order by coalesce(game.starts_at,request.requested_start_at);
$$;
revoke all on function public.list_my_mentor_observations() from public,anon;
grant execute on function public.list_my_mentor_observations() to authenticated;
