alter table public.games
  add column if not exists source_system text,
  add column if not exists source_event_id text,
  add column if not exists source_match_id text,
  add column if not exists source_synced_at timestamptz;

create unique index if not exists games_source_match_unique
  on public.games(source_system, source_event_id, source_match_id)
  where source_system is not null and source_event_id is not null and source_match_id is not null;

alter table public.teams
  add column if not exists source_system text,
  add column if not exists source_event_id text,
  add column if not exists source_team_id text;

create unique index if not exists teams_source_team_unique
  on public.teams(source_system, source_event_id, source_team_id)
  where source_system is not null and source_event_id is not null and source_team_id is not null;

alter table public.locations
  add column if not exists source_system text,
  add column if not exists source_event_id text,
  add column if not exists source_pitch_id text,
  add column if not exists source_venue_id text;

create unique index if not exists locations_source_pitch_unique
  on public.locations(source_system, source_event_id, source_pitch_id)
  where source_system is not null and source_event_id is not null and source_pitch_id is not null;

create table if not exists public.schedule_sync_venues (
  source_system text not null,
  source_event_id text not null,
  source_venue_id text not null,
  venue_name text not null,
  address text,
  city text,
  state text,
  checked_at timestamptz not null default now(),
  primary key (source_system, source_event_id, source_venue_id)
);

create table if not exists public.schedule_sync_runs (
  id uuid primary key default gen_random_uuid(),
  source_system text not null,
  source_event_id text not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running' check (status in ('running','success','failed')),
  groups_checked integer not null default 0,
  games_found integer not null default 0,
  games_added integer not null default 0,
  games_updated integer not null default 0,
  games_cancelled integer not null default 0,
  games_skipped integer not null default 0,
  error_message text
);

alter table public.schedule_sync_venues enable row level security;
alter table public.schedule_sync_runs enable row level security;
revoke all on public.schedule_sync_venues from anon, authenticated;
revoke all on public.schedule_sync_runs from anon, authenticated;

