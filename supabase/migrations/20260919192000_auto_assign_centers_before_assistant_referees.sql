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
      '  v_game_date date;
begin',
      '  v_game_date date;
  v_position_pass integer;
  v_max_position_pass integer;
begin'
    );

    v_definition := replace(
      v_definition,
      '  perform set_config(''refassign.auto_assign'', ''on'', true);
  for v_game in',
      '  perform set_config(''refassign.auto_assign'', ''on'', true);

  select coalesce(max(greatest(coalesce(game.officials_needed,1),0)),0)
    into v_max_position_pass
  from public.games game
  where game.organization_id=p_organization_id
    and game.league_id is not null
    and private.can_manage_organization_league(game.organization_id,game.league_id,auth.uid())
    and (game.starts_at at time zone ''America/Chicago'')::date between p_start_date and p_end_date
    and lower(coalesce(game.status,''open'')) not in (''cancelled'',''canceled'',''on hold'',''hold'',''rain out'',''rained out'');

  for v_position_pass in 1..v_max_position_pass loop
  for v_game in'
    );

    v_definition := replace(
      v_definition,
      '    v_games:=v_games+1;',
      '    if v_position_pass=1 then v_games:=v_games+1; end if;'
    );

    v_definition := replace(
      v_definition,
      '      order by position.sort_order
      limit v_needed_positions',
      '      order by position.sort_order
      offset greatest(v_position_pass-1,0)
      limit 1'
    );

    v_definition := replace(
      v_definition,
      '  end loop;
  perform set_config(''refassign.auto_assign'', ''off'', true);',
      '  end loop;
  end loop;
  perform set_config(''refassign.auto_assign'', ''off'', true);'
    );

    if v_definition = v_original
       or position('for v_position_pass in 1..v_max_position_pass loop' in v_definition)=0
       or position('offset greatest(v_position_pass-1,0)' in v_definition)=0
       or position('if v_position_pass=1 then v_games:=v_games+1' in v_definition)=0 then
      raise exception 'AutoAssign center-first rewrite did not match %', v_function_name;
    end if;

    execute v_definition;
  end loop;
end
$migration$;

comment on function public.run_my_auto_assign(uuid,date,date,integer) is
  'Runs AutoAssign in global position priority passes (all centers before AR1, then AR2) using explicitly eligible officials.';

comment on function public.run_organization_auto_assign(uuid,date,date,integer) is
  'Runs organization AutoAssign in global position priority passes (all centers before AR1, then AR2) using explicitly eligible officials.';
