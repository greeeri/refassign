-- Location read policies find games by location_id for each official schedule row.
create index if not exists games_location_id_idx
  on public.games (location_id)
  where location_id is not null;
