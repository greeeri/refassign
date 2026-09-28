-- Locations belong to the same transfer group only when explicitly configured.
alter table public.locations add column if not exists field_complex text;

create or replace function private.field_move_eligibility(
  p_official_id uuid, p_game_id uuid, p_position_id uuid
) returns text[] language plpgsql stable security definer set search_path = '' as $$
declare
  v_game record;
  v_position text;
  v_state text;
  v_timezone text;
  v_reasons text[] := '{}';
begin
  select g.*, s.name as sport_name into v_game
  from public.games g join public.sports s on s.id = g.sport_id
  where g.id = p_game_id;
  select lower(sp.name) into v_position from public.sport_positions sp
  where sp.id = p_position_id and sp.sport_id = v_game.sport_id;
  if v_position is null then raise exception 'The destination position does not belong to this game.'; end if;
  select upper(trim(l.state)) into v_state from public.locations l where l.id = v_game.location_id;
  v_timezone := case
    when v_state in ('CA','NV','OR','WA') then 'America/Los_Angeles'
    when v_state = 'AZ' then 'America/Phoenix'
    when v_state in ('CO','ID','MT','NM','UT','WY') then 'America/Denver'
    when v_state in ('CT','DC','DE','FL','GA','IN','KY','MA','MD','ME','MI','NC','NH','NJ','NY','OH','PA','RI','SC','VA','VT','WV') then 'America/New_York'
    when v_state = 'AK' then 'America/Anchorage'
    when v_state = 'HI' then 'Pacific/Honolulu'
    else 'America/Chicago' end;
  if not exists (select 1 from public.organization_officials oo where oo.organization_id = v_game.organization_id and oo.official_id = p_official_id and oo.active) then
    v_reasons := array_append(v_reasons, 'Official is not connected to this organization');
  end if;
  if not exists (select 1 from public.officials o where o.id = p_official_id and o.active
    and exists (select 1 from unnest(o.sports) sport where lower(sport) = lower(v_game.sport_name))) then
    v_reasons := array_append(v_reasons, 'Official is not active or eligible for this sport');
  end if;
  if v_game.league_id is not null and not exists (
    select 1 from public.official_league_eligibility e where e.official_id = p_official_id and e.league_id = v_game.league_id
  ) then v_reasons := array_append(v_reasons, 'League eligibility is missing'); end if;
  if v_game.level_id is not null and not exists (
    select 1 from public.official_level_eligibility e where e.official_id = p_official_id and e.level_id = v_game.level_id
      and (case when v_position in ('ar1','ar2') or v_position like '%assistant referee%' then e.ar_eligible
                when v_position like '%center%' or v_position like '%referee%' then e.center_eligible
                else true end)
  ) then v_reasons := array_append(v_reasons, 'Level or position eligibility is missing'); end if;
  if v_position like '%mentor%' and not exists (
    select 1 from public.official_mentor_certifications r where r.official_id = p_official_id and r.certified
  ) then v_reasons := array_append(v_reasons, 'Mentor certification is required'); end if;
  if exists (
    select 1 from public.official_availability_blocks b where b.official_id = p_official_id and (
      (b.block_type = 'time' and b.starts_at < v_game.starts_at + make_interval(mins => coalesce(v_game.duration_minutes,110)) and b.ends_at > v_game.starts_at)
      or (b.block_type = 'date' and (v_game.starts_at at time zone v_timezone)::date between b.start_date and b.end_date)
      or (b.block_type = 'location' and b.location_id = v_game.location_id)
      or (b.block_type = 'team' and b.team_id in (v_game.home_team_id,v_game.away_team_id))
    )
  ) then v_reasons := array_append(v_reasons, 'Official has an availability block'); end if;
  return v_reasons;
end;
$$;
revoke all on function private.field_move_eligibility(uuid,uuid,uuid) from public, anon, authenticated;

create or replace function public.move_official_between_fields(
  p_source_assignment_id uuid, p_target_game_id uuid, p_target_position_id uuid,
  p_mode text, p_accept boolean default false, p_override boolean default false
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_source public.assignments%rowtype;
  v_target public.assignments%rowtype;
  v_source_game public.games%rowtype;
  v_target_game public.games%rowtype;
  v_source_complex text;
  v_target_complex text;
  v_source_location public.locations%rowtype;
  v_target_location public.locations%rowtype;
  v_reasons text[];
  v_created_source uuid;
  v_created_target uuid;
  v_other record;
begin
  if p_mode not in ('transfer','switch') then raise exception 'Choose Transfer or Switch.'; end if;
  if auth.uid() is null then raise exception 'Sign in to move officials.'; end if;
  -- Serialize competing changes to either game before inspecting positions.
  perform 1 from public.games where id in (select unnest(array[p_target_game_id,(select game_id from public.assignments where id=p_source_assignment_id)])) order by id for update;
  select * into v_source from public.assignments where id = p_source_assignment_id for update;
  if not found or v_source.status in ('declined','cancelled','canceled') then raise exception 'The source assignment is no longer available.'; end if;
  select * into v_source_game from public.games where id = v_source.game_id;
  select * into v_target_game from public.games where id = p_target_game_id;
  if v_target_game.id is null or v_source_game.id = v_target_game.id
    or v_source_game.organization_id is distinct from v_target_game.organization_id
    or v_source_game.starts_at is distinct from v_target_game.starts_at
    or v_source_game.time_tbd or v_target_game.time_tbd then
    raise exception 'Choose another game at the exact same start time in this organization.';
  end if;
  if lower(v_source_game.status) not in ('active','open') or lower(v_target_game.status) not in ('active','open') then
    raise exception 'Both games must be active.';
  end if;
  if v_source_game.archived_at is not null or v_target_game.archived_at is not null then
    raise exception 'Archived games cannot receive a field move.';
  end if;
  if not p_accept and v_target_game.starts_at <= now() + interval '5 minutes' then
    raise exception 'The game starts too soon to request acceptance. Choose Accept the move now.';
  end if;
  if not (exists (select 1 from public.organization_memberships m where m.organization_id = v_source_game.organization_id
    and m.user_id = auth.uid() and m.role in ('owner','admin','assignor'))
    or exists (select 1 from public.organization_user_access_profiles p where p.organization_id = v_source_game.organization_id
      and p.user_id = auth.uid() and p.roles && array['admin','assignor']::text[])
    or exists (select 1 from public.protected_accounts p where p.user_id = auth.uid())) then raise exception 'No access to these games.'; end if;
  if not (exists (select 1 from public.organization_memberships m where m.organization_id = v_source_game.organization_id and m.user_id = auth.uid() and m.role in ('owner','admin'))
    or exists (select 1 from public.organization_user_access_profiles p where p.organization_id = v_source_game.organization_id and p.user_id = auth.uid() and p.roles @> array['admin']::text[])
    or exists (select 1 from public.protected_accounts p where p.user_id = auth.uid()))
    and exists (select 1 from public.organization_member_league_access access where access.organization_id = v_source_game.organization_id and access.user_id = auth.uid())
    and (not exists (select 1 from public.organization_member_league_access access where access.organization_id = v_source_game.organization_id and access.user_id = auth.uid() and access.league_id = v_source_game.league_id)
      or not exists (select 1 from public.organization_member_league_access access where access.organization_id = v_target_game.organization_id and access.user_id = auth.uid() and access.league_id = v_target_game.league_id)) then
    raise exception 'No league access to both games.';
  end if;
  if not (exists (select 1 from public.organization_memberships m where m.organization_id = v_source_game.organization_id and m.user_id = auth.uid() and m.role in ('owner','admin'))
    or exists (select 1 from public.protected_accounts p where p.user_id = auth.uid()))
    and exists (select 1 from public.organization_user_access_profiles p where p.organization_id = v_source_game.organization_id
    and p.user_id = auth.uid() and p.roles @> array['assignor']::text[] and not (p.roles @> array['admin']::text[])
    and cardinality(p.league_ids) > 0 and (not v_source_game.league_id = any(p.league_ids) or not v_target_game.league_id = any(p.league_ids))) then
    raise exception 'No league access to both games.';
  end if;
  if exists (select 1 from public.game_link_members where game_id in (v_source_game.id,v_target_game.id)) then
    raise exception 'Unlink these games before moving one official.';
  end if;
  select * into v_source_location from public.locations where id = v_source_game.location_id;
  select * into v_target_location from public.locations where id = v_target_game.location_id;
  v_source_complex := nullif(lower(trim(v_source_location.field_complex)),'');
  v_target_complex := nullif(lower(trim(v_target_location.field_complex)),'');
  if v_source_game.location_id = v_target_game.location_id or not (
    (v_source_complex is not null and v_source_complex = v_target_complex)
    or (v_source_location.venue_id is not null and v_source_location.venue_id = v_target_location.venue_id)
    or (nullif(trim(v_source_location.address),'') is not null and lower(trim(v_source_location.address)) = lower(trim(v_target_location.address))
      and lower(coalesce(v_source_location.city,'')) = lower(coalesce(v_target_location.city,''))
      and lower(coalesce(v_source_location.state,'')) = lower(coalesce(v_target_location.state,'')))
  ) then
    raise exception 'The fields must be different locations in the same complex.';
  end if;
  if lower(coalesce(v_source_location.city,'')) is distinct from lower(coalesce(v_target_location.city,''))
    or lower(coalesce(v_source_location.state,'')) is distinct from lower(coalesce(v_target_location.state,''))
    or not ((v_source_location.address is not null and lower(trim(v_source_location.address)) = lower(trim(v_target_location.address)))
      or (v_source_location.latitude is not null and v_source_location.longitude is not null
        and v_target_location.latitude is not null and v_target_location.longitude is not null
        and 6371 * 2 * asin(sqrt(power(sin(radians(v_target_location.latitude-v_source_location.latitude)/2),2)
        + cos(radians(v_source_location.latitude))*cos(radians(v_target_location.latitude))
        * power(sin(radians(v_target_location.longitude-v_source_location.longitude)/2),2))) <= 1)) then
    raise exception 'Fields in a complex must share an address or be within one kilometer.';
  end if;
  if not exists (select 1 from public.sport_positions sp where sp.id = p_target_position_id and sp.sport_id = v_target_game.sport_id
    and (select count(*) from public.sport_positions earlier where earlier.sport_id = sp.sport_id
      and (earlier.sort_order < sp.sort_order or (earlier.sort_order = sp.sort_order and earlier.id <= sp.id))) <= v_target_game.officials_needed) then
    raise exception 'The destination position is not an active slot.';
  end if;
  select * into v_target from public.assignments where game_id = p_target_game_id and position_id = p_target_position_id
    and status not in ('declined','cancelled','canceled') order by assigned_at desc limit 1 for update;
  if p_mode = 'transfer' and v_target.id is not null then raise exception 'Transfer requires an open position. Choose Switch for an occupied position.'; end if;
  if v_target.id is not null and v_target.official_id = v_source.official_id then raise exception 'This official is already in the destination position.'; end if;
  if v_source.payment_status in ('approved','paid') or (v_target.id is not null and v_target.payment_status in ('approved','paid'))
    or exists (select 1 from public.payroll_batch_items i where i.assignment_id in (v_source.id,v_target.id)) then
    raise exception 'Approved or processed payroll must be corrected before moving this official.';
  end if;
  if exists (select 1 from public.assignments a where a.game_id = v_target_game.id and a.official_id = v_source.official_id
    and a.status not in ('declined','cancelled','canceled') and a.id is distinct from v_target.id) then raise exception 'Official already has another position on the destination game.'; end if;
  if v_target.id is not null and exists (select 1 from public.assignments a where a.game_id = v_source_game.id and a.official_id = v_target.official_id
    and a.status not in ('declined','cancelled','canceled') and a.id <> v_source.id) then raise exception 'Other official already has another position on the source game.'; end if;
  if not exists (select 1 from public.organization_officials oo where oo.organization_id = v_target_game.organization_id and oo.official_id = v_source.official_id and oo.active)
    or (v_target.id is not null and not exists (select 1 from public.organization_officials oo where oo.organization_id = v_source_game.organization_id and oo.official_id = v_target.official_id and oo.active)) then
    raise exception 'Both officials must be active in this organization.';
  end if;
  v_reasons := private.field_move_eligibility(v_source.official_id,v_target_game.id,p_target_position_id);
  if v_target.id is not null then v_reasons := v_reasons || private.field_move_eligibility(v_target.official_id,v_source_game.id,v_source.position_id); end if;
  if cardinality(v_reasons) > 0 and not p_override then raise exception 'Eligibility override required: %',array_to_string(v_reasons,'; '); end if;
  -- Other bookings cannot be overridden, including bookings in another organization.
  for v_other in select a.official_id,g.game_number from public.assignments a join public.games g on g.id = a.game_id
    where a.official_id in (v_source.official_id,v_target.official_id) and a.id not in (v_source.id,coalesce(v_target.id,v_source.id))
      and a.status not in ('declined','cancelled','canceled') and lower(g.status) not in ('cancelled','canceled','rained_out','rain_out')
      and g.starts_at < v_target_game.starts_at + make_interval(mins => greatest(coalesce(v_source_game.duration_minutes,110),coalesce(v_target_game.duration_minutes,110)))
      and g.starts_at + make_interval(mins => coalesce(g.duration_minutes,110)) > v_target_game.starts_at
    limit 1
  loop raise exception 'Official has an overlapping assignment on Game #%.',v_other.game_number; end loop;
  delete from public.assignments where id in (v_source.id,v_target.id);
  -- Historic declined offers retain their audit records, but their unique
  -- game/position and game/official keys must be cleared for the new offer.
  delete from public.assignments where game_id = v_target_game.id and status in ('declined','cancelled')
    and (position_id = p_target_position_id or official_id = v_source.official_id);
  if v_target.id is not null then
    delete from public.assignments where game_id = v_source_game.id and status in ('declined','cancelled')
      and (position_id = v_source.position_id or official_id = v_target.official_id);
  end if;
  insert into public.assignments(game_id,position_id,official_id,status,published_at,responded_at,assignment_source)
  values (v_target_game.id,p_target_position_id,v_source.official_id,case when p_accept then 'accepted' else 'proposed' end,
    case when p_accept then now() else null end,case when p_accept then now() else null end,'manager') returning id into v_created_target;
  if v_target.id is not null then
    insert into public.assignments(game_id,position_id,official_id,status,published_at,responded_at,assignment_source)
    values (v_source_game.id,v_source.position_id,v_target.official_id,case when p_accept then 'accepted' else 'proposed' end,
      case when p_accept then now() else null end,case when p_accept then now() else null end,'manager') returning id into v_created_source;
  end if;
  insert into public.audit_history(entity_type,entity_id,game_id,assignment_id,action,actor_user_id,actor_name,summary)
  values ('assignment',v_created_target,v_target_game.id,v_created_target,p_mode,auth.uid(),public.audit_actor_name(auth.uid()),
    format('%s from Game #%s to Game #%s%s',initcap(p_mode),v_source_game.game_number,v_target_game.game_number,case when p_override then ' with eligibility override' else '' end));
  return jsonb_build_object('targetAssignmentId',v_created_target,'sourceAssignmentId',v_created_source,
    'targetGameId',v_target_game.id,'sourceGameId',v_source_game.id);
end;
$$;
revoke all on function public.move_official_between_fields(uuid,uuid,uuid,text,boolean,boolean) from public, anon;
grant execute on function public.move_official_between_fields(uuid,uuid,uuid,text,boolean,boolean) to authenticated;
