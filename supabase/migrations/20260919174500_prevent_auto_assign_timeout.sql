-- AutoAssign evaluates several correlated eligibility and scheduling checks for
-- every open game position.  Keep those lookups on indexed paths so tournament
-- sized date windows do not exhaust PostgREST's normal statement timeout.

create index if not exists assignments_active_official_game_idx
  on public.assignments (official_id, game_id, position_id)
  where status <> 'declined';

create index if not exists assignments_active_game_position_idx
  on public.assignments (game_id, position_id, official_id)
  where status <> 'declined';

create index if not exists assignment_declines_game_official_idx
  on public.assignment_declines (game_id, official_id);

create index if not exists organization_officials_active_roster_idx
  on public.organization_officials (organization_id, official_id)
  where active;

create index if not exists official_league_eligibility_official_league_idx
  on public.official_league_eligibility (official_id, league_id);

create index if not exists official_level_eligibility_official_level_idx
  on public.official_level_eligibility (official_id, level_id);

create index if not exists official_availability_blocks_time_idx
  on public.official_availability_blocks (official_id, starts_at, ends_at);

create index if not exists official_availability_blocks_rule_idx
  on public.official_availability_blocks
    (official_id, block_type, start_date, end_date, location_id, team_id);

create index if not exists games_auto_assign_window_idx
  on public.games (organization_id, starts_at, league_id)
  include (id, sport_id, level_id, status, home_team_id, away_team_id,
           location_id, duration_minutes, officials_needed);

create index if not exists assignor_official_rankings_lookup_idx
  on public.assignor_official_rankings (assignor_id, official_id);

create index if not exists assignor_team_power_rankings_lookup_idx
  on public.assignor_team_power_rankings (assignor_id, team_id);

create index if not exists official_mentor_certifications_lookup_idx
  on public.official_mentor_certifications (official_id);

-- This operation intentionally considers the complete selected window and is
-- allowed more time than ordinary interactive reads.  The indexes above keep
-- the additional allowance bounded to genuinely large assignment runs.
alter function public.run_my_auto_assign(uuid, date, date, integer)
  set statement_timeout = '120s';

alter function public.run_organization_auto_assign(uuid, date, date, integer)
  set statement_timeout = '120s';
