-- Game numbers belong to an organization's active league schedule, not to the
-- platform globally. Archived schedules are intentionally excluded so a
-- league can reuse its numbering in a future season after archiving the old
-- schedule.
create unique index if not exists games_active_league_game_number_unique
  on public.games (
    organization_id,
    league_id,
    lower(btrim(game_number))
  )
  where archived_at is null
    and organization_id is not null
    and league_id is not null
    and game_number is not null
    and btrim(game_number) <> '';

comment on index public.games_active_league_game_number_unique is
  'Prevents duplicate active game numbers within one organization and league while allowing the same number in different leagues and archived seasons.';
