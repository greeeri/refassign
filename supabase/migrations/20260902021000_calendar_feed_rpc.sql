create or replace function public.get_official_calendar_feed(p_token uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case when not exists (
    select 1 from public.official_calendar_tokens where token = p_token
  ) then null else coalesce((select jsonb_agg(jsonb_build_object(
    'id', assignment.id,
    'status', assignment.status,
    'assigned_at', assignment.assigned_at,
    'position_name', position.name,
    'game_id', game.id,
    'game_number', game.game_number,
    'game_status', game.status,
    'starts_at', game.starts_at,
    'duration_minutes', game.duration_minutes,
    'notes', game.notes,
    'home_name', home.name,
    'away_name', away.name,
    'location_name', location.name,
    'location_address', location.address,
    'location_city', location.city,
    'location_state', location.state,
    'league_name', league.name,
    'level_name', level.name
  ) order by game.starts_at)
  from public.official_calendar_tokens calendar
  join public.assignments assignment on assignment.official_id = calendar.official_id
  join public.games game on game.id = assignment.game_id
  left join public.sport_positions position on position.id = assignment.position_id
  left join public.teams home on home.id = game.home_team_id
  left join public.teams away on away.id = game.away_team_id
  left join public.locations location on location.id = game.location_id
  left join public.leagues league on league.id = game.league_id
  left join public.levels level on level.id = game.level_id
  where calendar.token = p_token
    and assignment.published_at is not null
    and game.starts_at >= now() - interval '90 days'), '[]'::jsonb) end;
$$;

revoke all on function public.get_official_calendar_feed(uuid) from public;
grant execute on function public.get_official_calendar_feed(uuid) to anon, authenticated;
