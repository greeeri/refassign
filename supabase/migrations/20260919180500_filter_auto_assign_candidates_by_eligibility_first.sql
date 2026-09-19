do $migration$
declare
  v_function_name text;
  v_definition text;
  v_original text;
begin
  foreach v_function_name in array array['run_my_auto_assign','run_organization_auto_assign']
  loop
    select pg_get_functiondef(p.oid)
      into v_definition
    from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public'
      and p.proname=v_function_name
      and pg_get_function_identity_arguments(p.oid)='p_organization_id uuid, p_start_date date, p_end_date date, p_same_team_limit integer';

    if v_definition is null then
      raise exception 'AutoAssign function % was not found', v_function_name;
    end if;

    v_original := v_definition;

    v_definition := replace(
      v_definition,
      'join public.organization_officials organization_official on organization_official.official_id=official.id and organization_official.organization_id=p_organization_id and organization_official.active',
      'join public.organization_officials organization_official on organization_official.official_id=official.id and organization_official.organization_id=p_organization_id and organization_official.active
      join public.official_league_eligibility league_eligibility on league_eligibility.official_id=official.id and league_eligibility.league_id=v_game.league_id
      left join public.official_level_eligibility level_eligibility on level_eligibility.official_id=official.id and level_eligibility.level_id=v_game.level_id'
    );

    v_definition := replace(
      v_definition,
      '        and (v_game.league_id is null or exists(select 1 from public.official_league_eligibility eligibility where eligibility.official_id=official.id and eligibility.league_id=v_game.league_id))
        and (v_game.level_id is null or exists(select 1 from public.official_level_eligibility eligibility where eligibility.official_id=official.id and eligibility.level_id=v_game.level_id))',
      '        and (v_game.level_id is null or level_eligibility.official_id is not null)'
    );

    if v_definition = v_original
       or position('join public.official_league_eligibility league_eligibility' in v_definition)=0
       or position('level_eligibility.official_id is not null' in v_definition)=0 then
      raise exception 'AutoAssign eligibility-first rewrite did not match %', v_function_name;
    end if;

    execute v_definition;
  end loop;
end
$migration$;

comment on function public.run_my_auto_assign(uuid,date,date,integer) is
  'Runs AutoAssign from the explicitly league- and level-eligible official pool before evaluating scheduling constraints.';

comment on function public.run_organization_auto_assign(uuid,date,date,integer) is
  'Runs organization AutoAssign from the explicitly league- and level-eligible official pool before evaluating scheduling constraints.';
