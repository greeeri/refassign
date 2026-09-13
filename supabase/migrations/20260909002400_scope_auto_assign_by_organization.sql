create or replace function public.run_organization_auto_assign(
  p_organization_id uuid,
  p_start_date date,
  p_end_date date
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_game record;
  v_pos record;
  v_rule record;
  v_official_id uuid;
  v_assigned integer := 0;
  v_open integer := 0;
  v_games integer := 0;
  v_needed_positions integer;
  v_game_date date;
begin
  if (select auth.uid()) is null or not private.can_manage_organization(p_organization_id) then
    raise exception 'Only an organization owner, administrator, or assignor can run AutoAssign.';
  end if;
  if p_start_date is null or p_end_date is null or p_end_date < p_start_date then
    raise exception 'A valid AutoAssign date range is required.';
  end if;

  perform set_config('refassign.auto_assign', 'on', true);
  for v_game in
    select game.*, sport.name as sport_name
    from public.games game
    join public.sports sport on sport.id=game.sport_id
    where game.organization_id=p_organization_id
      and (game.starts_at at time zone 'America/Chicago')::date between p_start_date and p_end_date
      and lower(coalesce(game.status,'open')) not in ('cancelled','canceled')
    order by game.starts_at,game.game_number
  loop
    v_games:=v_games+1;
    v_game_date:=(v_game.starts_at at time zone 'America/Chicago')::date;
    v_needed_positions:=greatest(coalesce(v_game.officials_needed,1),0);

    for v_pos in
      select position.* from public.sport_positions position
      where position.sport_id=v_game.sport_id
      order by position.sort_order
      limit v_needed_positions
    loop
      if exists(select 1 from public.assignments assignment where assignment.game_id=v_game.id and assignment.position_id=v_pos.id) then
        continue;
      end if;

      select rule.* into v_rule
      from public.auto_assign_rules rule
      where rule.organization_id=p_organization_id
        and rule.position_id=v_pos.id and rule.active
        and (rule.level_id=v_game.level_id or rule.level_id is null)
      order by case when rule.level_id=v_game.level_id then 0 else 1 end
      limit 1;
      if not found then
        v_rule.max_games_per_day:=2;
        v_rule.rest_days:=0;
        v_rule.same_team_days:=7;
      end if;

      select official.id into v_official_id
      from public.officials official
      join public.organization_officials organization_official
        on organization_official.official_id=official.id
       and organization_official.organization_id=p_organization_id
       and organization_official.active
      left join public.official_rankings general_rank on general_rank.official_id=official.id
      left join public.official_soccer_position_rankings position_rank on position_rank.official_id=official.id
      where official.active
        and exists(select 1 from unnest(official.sports) official_sport where lower(official_sport)=lower(v_game.sport_name))
        and not exists(select 1 from public.assignments assignment where assignment.game_id=v_game.id and assignment.official_id=official.id)
        and not exists(select 1 from public.assignment_declines decline where decline.game_id=v_game.id and decline.official_id=official.id)
        and (v_game.league_id is null or not exists(select 1 from public.official_league_eligibility eligibility where eligibility.official_id=official.id) or exists(select 1 from public.official_league_eligibility eligibility where eligibility.official_id=official.id and eligibility.league_id=v_game.league_id))
        and (v_game.level_id is null or not exists(select 1 from public.official_level_eligibility eligibility where eligibility.official_id=official.id) or exists(select 1 from public.official_level_eligibility eligibility where eligibility.official_id=official.id and eligibility.level_id=v_game.level_id))
        and not exists(
          select 1 from public.official_availability_blocks block
          where block.official_id=official.id and (
            (block.starts_at is not null and block.ends_at is not null and block.starts_at < v_game.starts_at + make_interval(mins=>coalesce(v_game.duration_minutes,110)) and block.ends_at > v_game.starts_at)
            or (block.block_type='date' and block.start_date is not null and block.end_date is not null and v_game_date between block.start_date and block.end_date)
            or (block.block_type='location' and block.location_id=v_game.location_id)
            or (block.block_type='team' and block.team_id in (v_game.home_team_id,v_game.away_team_id))
          )
        )
        and not exists(
          select 1 from public.assignments assignment join public.games other_game on other_game.id=assignment.game_id
          where assignment.official_id=official.id and assignment.game_id<>v_game.id
            and lower(coalesce(other_game.status,'open')) not in ('cancelled','canceled')
            and other_game.starts_at < v_game.starts_at + make_interval(mins=>coalesce(v_game.duration_minutes,110))
            and other_game.starts_at + make_interval(mins=>coalesce(other_game.duration_minutes,110)) > v_game.starts_at
        )
        and (select count(*) from public.assignments assignment join public.games day_game on day_game.id=assignment.game_id where assignment.official_id=official.id and lower(coalesce(day_game.status,'open')) not in ('cancelled','canceled') and (day_game.starts_at at time zone 'America/Chicago')::date=v_game_date) < coalesce(v_rule.max_games_per_day,2)
        and (coalesce(v_rule.rest_days,0)=0 or not exists(select 1 from public.assignments assignment join public.games rest_game on rest_game.id=assignment.game_id where assignment.official_id=official.id and assignment.position_id=v_pos.id and assignment.game_id<>v_game.id and rest_game.level_id is not distinct from v_game.level_id and abs((rest_game.starts_at at time zone 'America/Chicago')::date-v_game_date)<=v_rule.rest_days))
        and (coalesce(v_rule.same_team_days,0)=0 or not exists(select 1 from public.assignments assignment join public.games team_game on team_game.id=assignment.game_id where assignment.official_id=official.id and assignment.game_id<>v_game.id and abs((team_game.starts_at at time zone 'America/Chicago')::date-v_game_date)<=v_rule.same_team_days and ((v_game.home_team_id is not null and v_game.home_team_id in (team_game.home_team_id,team_game.away_team_id)) or (v_game.away_team_id is not null and v_game.away_team_id in (team_game.home_team_id,team_game.away_team_id)))))
        and (lower(v_pos.name) not like '%mentor%' or coalesce(position_rank.mentor_rank,1)>1)
      order by
        case
          when lower(v_pos.name) like '%mentor%' then coalesce(position_rank.mentor_rank,general_rank.rank,1)
          when lower(v_pos.name) like '%assistant referee 1%' or lower(v_pos.name)='ar1' then coalesce(position_rank.ar1_rank,general_rank.rank,1)
          when lower(v_pos.name) like '%assistant referee 2%' or lower(v_pos.name)='ar2' then coalesce(position_rank.ar2_rank,general_rank.rank,1)
          when lower(v_pos.name) like '%4th%' or lower(v_pos.name) like '%fourth%' then coalesce(position_rank.fourth_rank,general_rank.rank,1)
          when lower(v_pos.name) like '%center%' or (lower(v_pos.name) like '%referee%' and lower(v_pos.name) not like '%assistant%') then coalesce(position_rank.ref_rank,general_rank.rank,1)
          else coalesce(general_rank.rank,1)
        end desc,
        (select count(*) from public.assignments assignment join public.games day_game on day_game.id=assignment.game_id where assignment.official_id=official.id and (day_game.starts_at at time zone 'America/Chicago')::date=v_game_date) asc,
        (select count(*) from public.assignments assignment join public.games recent_game on recent_game.id=assignment.game_id where assignment.official_id=official.id and recent_game.starts_at>=v_game.starts_at-interval '30 days' and recent_game.starts_at<v_game.starts_at) asc,
        official.last_name,official.first_name
      limit 1;

      if v_official_id is null then
        v_open:=v_open+1;
      else
        insert into public.assignments(game_id,official_id,position_id,status)
        values(v_game.id,v_official_id,v_pos.id,'proposed')
        on conflict do nothing;
        if found then v_assigned:=v_assigned+1; else v_open:=v_open+1; end if;
      end if;
      v_official_id:=null;
    end loop;
  end loop;
  perform set_config('refassign.auto_assign', 'off', true);
  return jsonb_build_object('games_processed',v_games,'assignments_created',v_assigned,'positions_left_open',v_open,'start_date',p_start_date,'end_date',p_end_date);
exception when others then
  perform set_config('refassign.auto_assign', 'off', true);
  raise;
end;
$$;

revoke all on function public.run_organization_auto_assign(uuid,date,date) from public,anon;
grant execute on function public.run_organization_auto_assign(uuid,date,date) to authenticated;

comment on function public.run_organization_auto_assign(uuid,date,date) is
  'Runs AutoAssign only for games and active officials connected to one authorized organization.';
