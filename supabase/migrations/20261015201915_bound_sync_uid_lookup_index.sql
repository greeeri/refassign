create index if not exists games_bound_uid_lookup_idx on public.games(organization_id,league_id,lower(source_match_id)) where source_match_id is not null;
