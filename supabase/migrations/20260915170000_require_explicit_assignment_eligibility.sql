-- Officials must have an explicit matching eligibility row for every league
-- and level specified on a game. Missing eligibility is not unrestricted.
do $migration$
declare
  function_row record;
  definition text;
begin
  for function_row in
    select procedure.oid
    from pg_proc procedure
    join pg_namespace namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and procedure.proname in (
        'run_auto_assign_core',
        'run_my_auto_assign',
        'run_organization_auto_assign',
        'list_my_self_assign_positions',
        'claim_self_assign_position'
      )
  loop
    definition := pg_get_functiondef(function_row.oid);

    -- AutoAssign and self-assign listing previously treated no rows as global access.
    definition := regexp_replace(
      definition,
      E'(\\m(?:v_game|game)\\.league_id\\M\\s+is null\\s+or)\\s+not exists \\(select 1 from public\\.official_league_eligibility ([a-z_]+) where \\2\\.official_id=(?:official|o|me)\\.id\\)\\s+or',
      E'\\1',
      'gi'
    );

    -- Current AutoAssign functions use intentionally compact SQL formatting.
    definition := replace(
      definition,
      'v_game.league_id is null or not exists(select 1 from public.official_league_eligibility eligibility where eligibility.official_id=official.id) or exists',
      'v_game.league_id is null or exists'
    );
    definition := replace(
      definition,
      'v_game.level_id is null or not exists(select 1 from public.official_level_eligibility eligibility where eligibility.official_id=official.id) or exists',
      'v_game.level_id is null or exists'
    );
    definition := replace(
      definition,
      'v_game.league_id is null or not exists(select 1 from public.official_league_eligibility e where e.official_id=o.id) or exists',
      'v_game.league_id is null or exists'
    );
    definition := replace(
      definition,
      'v_game.level_id is null or not exists(select 1 from public.official_level_eligibility e where e.official_id=o.id) or exists',
      'v_game.level_id is null or exists'
    );
    definition := regexp_replace(
      definition,
      E'(\\m(?:v_game|game)\\.level_id\\M\\s+is null\\s+or)\\s+not exists \\(select 1 from public\\.official_level_eligibility ([a-z_]+) where \\2\\.official_id=(?:official|o|me)\\.id\\)\\s+or',
      E'\\1',
      'gi'
    );

    -- Claim validation previously rejected a mismatch only after at least one row existed.
    definition := regexp_replace(
      definition,
      E'and exists \\(select 1 from public\\.official_league_eligibility ([a-z_]+) where \\1\\.official_id=v_official_id\\)\\s+and not exists',
      'and not exists',
      'gi'
    );
    definition := regexp_replace(
      definition,
      E'and exists \\(select 1 from public\\.official_level_eligibility ([a-z_]+) where \\1\\.official_id=v_official_id\\)\\s+and not exists',
      'and not exists',
      'gi'
    );

    execute definition;
  end loop;
end
$migration$;
