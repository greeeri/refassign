create or replace function public.apply_game_import(p_rows jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_row jsonb;
  v_added integer := 0;
  v_updated integer := 0;
  v_skipped integer := 0;
begin
  if not (select public.can_manage_game_setup()) then
    raise exception 'Only an assignor or administrator can import games' using errcode = '42501';
  end if;
  if jsonb_typeof(p_rows) <> 'array' then
    raise exception 'Import payload must be an array';
  end if;

  for v_row in select value from jsonb_array_elements(p_rows)
  loop
    if v_row->>'action' = 'skip' then
      v_skipped := v_skipped + 1;
      continue;
    end if;
    begin
      if v_row->>'action' = 'update' then
        update public.games
        set sport_id = (v_row->>'sport_id')::uuid,
            league_id = (v_row->>'league_id')::uuid,
            level_id = (v_row->>'level_id')::uuid,
            level = v_row->>'level_name',
            home_team_id = (v_row->>'home_team_id')::uuid,
            away_team_id = (v_row->>'away_team_id')::uuid,
            location_id = (v_row->>'location_id')::uuid,
            starts_at = (v_row->>'starts_at')::timestamptz,
            duration_minutes = (v_row->>'duration_minutes')::integer,
            officials_needed = (v_row->>'officials_needed')::integer,
            notes = nullif(v_row->>'notes', '')
        where id = (v_row->>'game_id')::uuid;
        if not found then
          raise exception 'The game being updated no longer exists';
        end if;
        v_updated := v_updated + 1;
      elsif v_row->>'action' = 'add' then
        insert into public.games (
          game_number, sport_id, league_id, level_id, level,
          home_team_id, away_team_id, location_id, starts_at,
          duration_minutes, officials_needed, notes, status
        ) values (
          nullif(v_row->>'game_number', ''),
          (v_row->>'sport_id')::uuid,
          (v_row->>'league_id')::uuid,
          (v_row->>'level_id')::uuid,
          v_row->>'level_name',
          (v_row->>'home_team_id')::uuid,
          (v_row->>'away_team_id')::uuid,
          (v_row->>'location_id')::uuid,
          (v_row->>'starts_at')::timestamptz,
          (v_row->>'duration_minutes')::integer,
          (v_row->>'officials_needed')::integer,
          nullif(v_row->>'notes', ''),
          'open'
        );
        v_added := v_added + 1;
      else
        raise exception 'Unsupported import action: %', coalesce(v_row->>'action', 'blank');
      end if;
    exception when others then
      raise exception 'Spreadsheet row % — Game % — %',
        coalesce(v_row->>'row', '?'),
        coalesce(nullif(v_row->>'game_number', ''), 'NEW'),
        sqlerrm;
    end;
  end loop;

  return jsonb_build_object('added', v_added, 'updated', v_updated, 'skipped', v_skipped);
end;
$$;

revoke all on function public.apply_game_import(jsonb) from public, anon;
grant execute on function public.apply_game_import(jsonb) to authenticated;

create or replace function public.validate_game_import(p_rows jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  begin
    v_result := public.apply_game_import(p_rows);
    raise exception 'validation rollback' using errcode = 'P0002';
  exception when sqlstate 'P0002' then
    return v_result;
  end;
end;
$$;

revoke all on function public.validate_game_import(jsonb) from public, anon;
grant execute on function public.validate_game_import(jsonb) to authenticated;
