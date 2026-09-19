-- Evaluate update imports as one final schedule. Existing games that are being
-- updated are temporarily marked Time TBD so an early row cannot conflict with
-- the old state of a game changed by a later row. The transaction remains
-- atomic, and final-state conflicts still fail validation/application.

drop trigger if exists game_audit_trigger on public.games;
create trigger game_audit_trigger after update on public.games
for each row
when (
  old.* is distinct from new.*
  and current_setting('refassign.game_import_staging', true) is distinct from 'on'
)
execute function public.log_game_audit();

drop trigger if exists undo_capture_games on public.games;
create trigger undo_capture_games after insert or update or delete on public.games
for each row
when (current_setting('refassign.game_import_staging', true) is distinct from 'on')
execute function public.capture_undo_change();

create or replace function public.apply_game_import(p_rows jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_row jsonb;
  v_organization_id uuid;
  v_league_id uuid;
  v_level_id uuid;
  v_home_team_id uuid;
  v_away_team_id uuid;
  v_location_id uuid;
  v_bill_to_id uuid;
  v_added integer := 0;
  v_updated integer := 0;
  v_skipped integer := 0;
begin
  if jsonb_typeof(p_rows) <> 'array' then
    raise exception 'Import payload must be an array';
  end if;

  -- Preflight every update before changing any row.
  for v_row in select value from jsonb_array_elements(p_rows)
  loop
    if v_row->>'action' not in ('update', 'add', 'skip') then
      raise exception 'Spreadsheet row % — Game % — unsupported import action: %',
        coalesce(v_row->>'row', '?'),
        coalesce(nullif(v_row->>'game_number', ''), 'NEW'),
        coalesce(v_row->>'action', 'blank');
    end if;
    if v_row->>'action' = 'skip' then continue; end if;

    v_organization_id := (v_row->>'organization_id')::uuid;
    v_league_id := (v_row->>'league_id')::uuid;
    if auth.uid() is null or not private.can_manage_organization(v_organization_id) then
      raise exception 'Spreadsheet row % — Game % — you cannot import games for this organization',
        coalesce(v_row->>'row', '?'), coalesce(nullif(v_row->>'game_number', ''), 'NEW')
        using errcode = '42501';
    end if;
    if not private.can_manage_organization_league(v_organization_id, v_league_id, auth.uid()) then
      raise exception 'Spreadsheet row % — Game % — the selected league is not available to this organization',
        coalesce(v_row->>'row', '?'), coalesce(nullif(v_row->>'game_number', ''), 'NEW')
        using errcode = '42501';
    end if;
    if v_row->>'action' = 'update' and not exists (
      select 1 from public.games
      where id = (v_row->>'game_id')::uuid and organization_id = v_organization_id
    ) then
      raise exception 'Spreadsheet row % — Game % — the game being updated is not in the selected organization',
        coalesce(v_row->>'row', '?'), coalesce(nullif(v_row->>'game_number', ''), 'NEW');
    end if;
  end loop;

  -- Remove the old schedule positions of every update in one operation. This
  -- prevents spreadsheet row order from affecting otherwise valid changes.
  perform set_config('refassign.game_import_staging', 'on', true);
  update public.games game
  set time_tbd = true
  where game.id in (
    select (row_value->>'game_id')::uuid
    from jsonb_array_elements(p_rows) row_value
    where row_value->>'action' = 'update'
  );
  perform set_config('refassign.game_import_staging', 'off', true);

  for v_row in select value from jsonb_array_elements(p_rows)
  loop
    if v_row->>'action' = 'skip' then
      v_skipped := v_skipped + 1;
      continue;
    end if;
    begin
      v_organization_id := (v_row->>'organization_id')::uuid;
      v_league_id := (v_row->>'league_id')::uuid;
      v_level_id := (v_row->>'level_id')::uuid;
      v_home_team_id := (v_row->>'home_team_id')::uuid;
      v_away_team_id := (v_row->>'away_team_id')::uuid;
      v_location_id := (v_row->>'location_id')::uuid;
      v_bill_to_id := nullif(v_row->>'bill_to_id', '')::uuid;

      if not exists (select 1 from public.organization_levels x where x.organization_id = v_organization_id and x.level_id = v_level_id and x.active) then
        raise exception 'The selected level is not active for this organization';
      end if;
      if not exists (select 1 from public.organization_teams x where x.organization_id = v_organization_id and x.team_id = v_home_team_id and x.active)
         or not exists (select 1 from public.organization_teams x where x.organization_id = v_organization_id and x.team_id = v_away_team_id and x.active) then
        raise exception 'One or both teams are not active for this organization';
      end if;
      if not exists (select 1 from public.organization_locations x where x.organization_id = v_organization_id and x.location_id = v_location_id and x.active) then
        raise exception 'The selected location is not active for this organization';
      end if;
      if v_bill_to_id is not null and not exists (
        select 1 from public.bill_to_accounts x
        where x.id = v_bill_to_id and x.organization_id = v_organization_id and x.active
      ) then
        raise exception 'The selected Bill To is not active for this organization';
      end if;

      if v_row->>'action' = 'update' then
        update public.games
        set sport_id = (v_row->>'sport_id')::uuid,
            league_id = v_league_id,
            level_id = v_level_id,
            level = v_row->>'level_name',
            home_team_id = v_home_team_id,
            away_team_id = v_away_team_id,
            location_id = v_location_id,
            bill_to_id = v_bill_to_id,
            starts_at = (v_row->>'starts_at')::timestamptz,
            time_tbd = coalesce((v_row->>'time_tbd')::boolean, false),
            field_tbd = coalesce((v_row->>'field_tbd')::boolean, false),
            duration_minutes = (v_row->>'duration_minutes')::integer,
            officials_needed = (v_row->>'officials_needed')::integer,
            notes = nullif(v_row->>'notes', '')
        where id = (v_row->>'game_id')::uuid and organization_id = v_organization_id;
        v_updated := v_updated + 1;
      else
        insert into public.games (
          organization_id, game_number, sport_id, league_id, level_id, level,
          home_team_id, away_team_id, location_id, bill_to_id, starts_at,
          time_tbd, field_tbd, duration_minutes, officials_needed, notes, status
        ) values (
          v_organization_id, nullif(v_row->>'game_number', ''),
          (v_row->>'sport_id')::uuid, v_league_id, v_level_id,
          v_row->>'level_name', v_home_team_id, v_away_team_id,
          v_location_id, v_bill_to_id, (v_row->>'starts_at')::timestamptz,
          coalesce((v_row->>'time_tbd')::boolean, false),
          coalesce((v_row->>'field_tbd')::boolean, false),
          (v_row->>'duration_minutes')::integer,
          (v_row->>'officials_needed')::integer,
          nullif(v_row->>'notes', ''), 'open'
        );
        v_added := v_added + 1;
      end if;
    exception when others then
      raise exception 'Spreadsheet row % — Game % — %',
        coalesce(v_row->>'row', '?'),
        coalesce(nullif(v_row->>'game_number', ''), 'NEW'), sqlerrm;
    end;
  end loop;

  return jsonb_build_object('added', v_added, 'updated', v_updated, 'skipped', v_skipped);
end;
$$;

revoke all on function public.apply_game_import(jsonb) from public, anon;
grant execute on function public.apply_game_import(jsonb) to authenticated;
