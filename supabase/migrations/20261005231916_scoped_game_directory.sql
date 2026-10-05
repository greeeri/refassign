-- Scope directory rows before building the response, rather than filtering a global directory in the browser.
create function private.get_game_directory_impl(p_organization_id uuid,p_league_id uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare team_ids uuid[]; level_ids uuid[];
begin
  if (select auth.uid()) is null or not private.can_access_organization(p_organization_id) then
    raise exception 'Not authorized.' using errcode='42501';
  end if;
  if p_league_id is not null and not (public.is_super_admin() or private.can_access_organization_league(p_organization_id,p_league_id,(select auth.uid()))) then
    raise exception 'League is not available.' using errcode='42501';
  end if;
  select s.team_ids into team_ids from private.organization_league_team_settings s where s.organization_id=p_organization_id and s.league_id=p_league_id;
  select s.level_ids into level_ids from private.organization_league_level_settings s where s.organization_id=p_organization_id and s.league_id=p_league_id;
  return jsonb_build_object(
    'teams',coalesce((select jsonb_agg(jsonb_build_object('id',t.id,'name',t.name,'sport_id',t.sport_id,'level_id',t.level_id) order by t.name,t.id)
      from public.organization_teams ot join public.teams t on t.id=ot.team_id
      where ot.organization_id=p_organization_id
        and ((ot.active and t.active and (team_ids is null or t.id=any(team_ids))) or exists(select 1 from public.games g where g.organization_id=p_organization_id and g.league_id=p_league_id and (g.home_team_id=t.id or g.away_team_id=t.id)))),'[]'::jsonb),
    'levels',coalesce((select jsonb_agg(jsonb_build_object('id',l.id,'name',l.name) order by l.name,l.id)
      from public.organization_levels ol join public.levels l on l.id=ol.level_id
      where ol.organization_id=p_organization_id
        and ((ol.active and l.active and (level_ids is null or l.id=any(level_ids))) or exists(select 1 from public.games g where g.organization_id=p_organization_id and g.league_id=p_league_id and g.level_id=l.id))),'[]'::jsonb),
    'team_settings',case when team_ids is null then '[]'::jsonb else jsonb_build_array(jsonb_build_object('league_id',p_league_id,'team_ids',team_ids)) end,
    'level_settings',case when level_ids is null then '[]'::jsonb else jsonb_build_array(jsonb_build_object('league_id',p_league_id,'level_ids',level_ids)) end
  );
end $$;
create function public.get_game_directory(p_organization_id uuid,p_league_id uuid default null)
returns jsonb language sql security invoker set search_path='' as $$
  select private.get_game_directory_impl(p_organization_id,p_league_id)
$$;
revoke all on function private.get_game_directory_impl(uuid,uuid),public.get_game_directory(uuid,uuid) from public,anon;
grant execute on function private.get_game_directory_impl(uuid,uuid),public.get_game_directory(uuid,uuid) to authenticated,service_role;
