-- Mentor eligibility is a shared certification, not an assignor's performance score.
create table public.official_mentor_certifications (
  official_id uuid primary key references public.officials(id) on delete cascade,
  certified boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);
alter table public.official_mentor_certifications enable row level security;
revoke all on public.official_mentor_certifications from public,anon,authenticated;
grant select,insert,update on public.official_mentor_certifications to authenticated;
create policy "Managers read mentor certification" on public.official_mentor_certifications
for select to authenticated using (private.can_rank_official(official_id));
create policy "Managers add mentor certification" on public.official_mentor_certifications
for insert to authenticated with check (private.can_rank_official(official_id) and updated_by=(select auth.uid()));
create policy "Managers update mentor certification" on public.official_mentor_certifications
for update to authenticated using (private.can_rank_official(official_id))
with check (private.can_rank_official(official_id) and updated_by=(select auth.uid()));

-- Preserve the prior mentor-eligible flag (>1). Unrated officials stay unchecked.
insert into public.official_mentor_certifications(official_id,certified)
select official_id,true from public.official_soccer_position_rankings where mentor_rank>1
union
select official_id,true from public.assignor_official_rankings where mentor_rank>1;

create view public.my_assignment_rankings with (security_invoker=true) as
select official.id official_id,coalesce(rating.rank,1) rank,
  coalesce(rating.ref_rank,1) ref_rank,coalesce(rating.ar1_rank,1) ar1_rank,
  coalesce(rating.ar2_rank,1) ar2_rank,coalesce(rating.fourth_rank,1) fourth_rank,
  coalesce(mentor.certified,false) mentor_certified
from public.officials official
left join public.assignor_official_rankings rating on rating.official_id=official.id and rating.assignor_id=auth.uid()
left join public.official_mentor_certifications mentor on mentor.official_id=official.id;
revoke all on public.my_assignment_rankings from public,anon,authenticated;
grant select on public.my_assignment_rankings to authenticated;

create function public.set_my_official_assessment(
  p_official_id uuid,p_rank numeric,p_ref_rank numeric,p_ar1_rank numeric,
  p_ar2_rank numeric,p_fourth_rank numeric,p_mentor_certified boolean
)
returns void language plpgsql security invoker set search_path='' as $$
begin
  if auth.uid() is null then raise exception 'Sign in to save official ratings and certification' using errcode='42501'; end if;
  if p_mentor_certified is null then raise exception 'Mentor certification must be checked or unchecked'; end if;
  if exists(select 1 from unnest(array[p_rank,p_ref_rank,p_ar1_rank,p_ar2_rank,p_fourth_rank]) value
    where value is null or value not between 1 and 10) then
    raise exception 'All performance rankings must be between 1 and 10';
  end if;
  insert into public.assignor_official_rankings(assignor_id,official_id,rank,ref_rank,ar1_rank,ar2_rank,fourth_rank,updated_at)
  values(auth.uid(),p_official_id,p_rank,p_ref_rank,p_ar1_rank,p_ar2_rank,p_fourth_rank,now())
  on conflict(assignor_id,official_id) do update set rank=excluded.rank,ref_rank=excluded.ref_rank,
    ar1_rank=excluded.ar1_rank,ar2_rank=excluded.ar2_rank,fourth_rank=excluded.fourth_rank,updated_at=now();
  insert into public.official_mentor_certifications(official_id,certified,updated_by,updated_at)
  values(p_official_id,p_mentor_certified,auth.uid(),now())
  on conflict(official_id) do update set certified=excluded.certified,updated_by=auth.uid(),updated_at=now();
end;
$$;
revoke all on function public.set_my_official_assessment(uuid,numeric,numeric,numeric,numeric,numeric,boolean) from public,anon;
grant execute on function public.set_my_official_assessment(uuid,numeric,numeric,numeric,numeric,numeric,boolean) to authenticated;

-- Enforce the certification in every assignment path, including bulk and templates.
-- Existing assignments can still be accepted, published or removed after certification changes.
create function private.require_mentor_certification()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if tg_op='UPDATE' and new.official_id is not distinct from old.official_id
    and new.position_id is not distinct from old.position_id and new.game_id is not distinct from old.game_id then
    return new;
  end if;
  if exists(select 1 from public.sport_positions p where p.id=new.position_id and lower(p.name) like '%mentor%')
    and not exists(select 1 from public.official_mentor_certifications c where c.official_id=new.official_id and c.certified) then
    raise exception 'Mentor certification is required for this position.' using errcode='23514';
  end if;
  return new;
end;
$$;
revoke all on function private.require_mentor_certification() from public,anon,authenticated;
create trigger require_mentor_certification
before insert or update of official_id,position_id,game_id on public.assignments
for each row execute function private.require_mentor_certification();

CREATE OR REPLACE FUNCTION public.run_my_auto_assign(p_organization_id uuid, p_start_date date, p_end_date date, p_same_team_limit integer DEFAULT 1)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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
  if (select auth.uid()) is null or not (private.can_access_organization(p_organization_id) and exists (select 1 from public.organization_memberships m where m.organization_id=p_organization_id and m.user_id=auth.uid() and m.role in ('owner','admin','assignor'))) then
    raise exception 'Only an organization owner, administrator, or assignor can run AutoAssign.';
  end if;
  if p_start_date is null or p_end_date is null or p_end_date < p_start_date then
    raise exception 'A valid AutoAssign date range is required.';
  end if;
  if p_same_team_limit is null or p_same_team_limit < 1 or p_same_team_limit > 100 then
    raise exception 'The same-team assignment limit must be between 1 and 100.';
  end if;

  perform set_config('refassign.auto_assign', 'on', true);
  for v_game in
    select game.*, sport.name as sport_name
    from public.games game
    join public.sports sport on sport.id=game.sport_id
    left join public.assignor_team_power_rankings home_power on home_power.team_id=game.home_team_id and home_power.assignor_id=auth.uid()
    left join public.assignor_team_power_rankings away_power on away_power.team_id=game.away_team_id and away_power.assignor_id=auth.uid()
    where game.organization_id=p_organization_id
      and game.league_id is not null
      and private.can_manage_organization_league(game.organization_id,game.league_id,auth.uid())
      and (game.starts_at at time zone 'America/Chicago')::date between p_start_date and p_end_date
      and lower(coalesce(game.status,'open')) not in ('cancelled','canceled','on hold','hold','rain out','rained out')
    order by (coalesce(home_power.power,1)+coalesce(away_power.power,1))/2 desc,game.starts_at,game.game_number
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
      if exists(select 1 from public.assignments assignment where assignment.game_id=v_game.id and assignment.position_id=v_pos.id and assignment.status<>'declined') then
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
      join public.organization_officials organization_official on organization_official.official_id=official.id and organization_official.organization_id=p_organization_id and organization_official.active
      left join public.assignor_official_rankings general_rank on general_rank.official_id=official.id and general_rank.assignor_id=auth.uid()
      left join public.assignor_official_rankings position_rank on position_rank.official_id=official.id and position_rank.assignor_id=auth.uid()
      left join public.official_mentor_certifications mentor on mentor.official_id=official.id
      where official.active
        and exists(select 1 from unnest(official.sports) official_sport where lower(official_sport)=lower(v_game.sport_name))
        and not exists(select 1 from public.assignments assignment where assignment.game_id=v_game.id and assignment.official_id=official.id and assignment.status<>'declined')
        and not exists(select 1 from public.assignment_declines decline where decline.game_id=v_game.id and decline.official_id=official.id)
        and (v_game.league_id is null or not exists(select 1 from public.official_league_eligibility eligibility where eligibility.official_id=official.id) or exists(select 1 from public.official_league_eligibility eligibility where eligibility.official_id=official.id and eligibility.league_id=v_game.league_id))
        and (v_game.level_id is null or not exists(select 1 from public.official_level_eligibility eligibility where eligibility.official_id=official.id) or exists(select 1 from public.official_level_eligibility eligibility where eligibility.official_id=official.id and eligibility.level_id=v_game.level_id))
        and not exists(select 1 from public.official_availability_blocks block where block.official_id=official.id and ((block.starts_at is not null and block.ends_at is not null and block.starts_at < v_game.starts_at + make_interval(mins=>coalesce(v_game.duration_minutes,110)) and block.ends_at > v_game.starts_at) or (block.block_type='date' and block.start_date is not null and block.end_date is not null and v_game_date between block.start_date and block.end_date) or (block.block_type='location' and block.location_id=v_game.location_id) or (block.block_type='team' and block.team_id in (v_game.home_team_id,v_game.away_team_id))))
        and not exists(select 1 from public.assignments assignment join public.games other_game on other_game.id=assignment.game_id where assignment.official_id=official.id and assignment.game_id<>v_game.id and assignment.status<>'declined' and lower(coalesce(other_game.status,'open')) not in ('cancelled','canceled','on hold','hold','rain out','rained out') and other_game.starts_at < v_game.starts_at + make_interval(mins=>coalesce(v_game.duration_minutes,110)) and other_game.starts_at + make_interval(mins=>coalesce(other_game.duration_minutes,110)) > v_game.starts_at)
        and (select count(*) from public.assignments assignment join public.games day_game on day_game.id=assignment.game_id where assignment.official_id=official.id and assignment.status<>'declined' and lower(coalesce(day_game.status,'open')) not in ('cancelled','canceled','on hold','hold','rain out','rained out') and (day_game.starts_at at time zone 'America/Chicago')::date=v_game_date) < coalesce(v_rule.max_games_per_day,2)
        and (coalesce(v_rule.rest_days,0)=0 or not exists(select 1 from public.assignments assignment join public.games rest_game on rest_game.id=assignment.game_id where assignment.official_id=official.id and assignment.status<>'declined' and assignment.position_id=v_pos.id and assignment.game_id<>v_game.id and rest_game.level_id is not distinct from v_game.level_id and abs((rest_game.starts_at at time zone 'America/Chicago')::date-v_game_date)<=v_rule.rest_days))
        and (coalesce(v_rule.same_team_days,0)=0 or not exists(select 1 from public.assignments assignment join public.games team_game on team_game.id=assignment.game_id where assignment.official_id=official.id and assignment.status<>'declined' and assignment.game_id<>v_game.id and abs((team_game.starts_at at time zone 'America/Chicago')::date-v_game_date)<=v_rule.same_team_days and ((v_game.home_team_id is not null and v_game.home_team_id in (team_game.home_team_id,team_game.away_team_id)) or (v_game.away_team_id is not null and v_game.away_team_id in (team_game.home_team_id,team_game.away_team_id)))))
        and (select count(*) from public.assignments assignment join public.games team_game on team_game.id=assignment.game_id where assignment.official_id=official.id and assignment.status<>'declined' and team_game.organization_id=p_organization_id and (team_game.starts_at at time zone 'America/Chicago')::date between p_start_date and p_end_date and ((v_game.home_team_id is not null and v_game.home_team_id in (team_game.home_team_id,team_game.away_team_id)) or (v_game.away_team_id is not null and v_game.away_team_id in (team_game.home_team_id,team_game.away_team_id)))) < p_same_team_limit
        and (lower(v_pos.name) not like '%mentor%' or coalesce(mentor.certified,false))
      order by case when lower(v_pos.name) like '%mentor%' then 1 when lower(v_pos.name) like '%assistant referee 1%' or lower(v_pos.name)='ar1' then coalesce(position_rank.ar1_rank,general_rank.rank,1) when lower(v_pos.name) like '%assistant referee 2%' or lower(v_pos.name)='ar2' then coalesce(position_rank.ar2_rank,general_rank.rank,1) when lower(v_pos.name) like '%4th%' or lower(v_pos.name) like '%fourth%' then coalesce(position_rank.fourth_rank,general_rank.rank,1) when lower(v_pos.name) like '%center%' or (lower(v_pos.name) like '%referee%' and lower(v_pos.name) not like '%assistant%') then coalesce(position_rank.ref_rank,general_rank.rank,1) else coalesce(general_rank.rank,1) end desc,
        (select count(*) from public.assignments assignment join public.games day_game on day_game.id=assignment.game_id where assignment.official_id=official.id and assignment.status<>'declined' and (day_game.starts_at at time zone 'America/Chicago')::date=v_game_date) asc,
        (select count(*) from public.assignments assignment join public.games recent_game on recent_game.id=assignment.game_id where assignment.official_id=official.id and assignment.status<>'declined' and recent_game.starts_at>=v_game.starts_at-interval '30 days' and recent_game.starts_at<v_game.starts_at) asc,
        official.last_name,official.first_name
      limit 1;

      if v_official_id is null then v_open:=v_open+1;
      else
        insert into public.assignments(game_id,official_id,position_id,status) values(v_game.id,v_official_id,v_pos.id,'proposed') on conflict do nothing;
        if found then v_assigned:=v_assigned+1; else v_open:=v_open+1; end if;
      end if;
      v_official_id:=null;
    end loop;
  end loop;
  perform set_config('refassign.auto_assign', 'off', true);
  return jsonb_build_object('games_processed',v_games,'assignments_created',v_assigned,'positions_left_open',v_open,'start_date',p_start_date,'end_date',p_end_date,'same_team_limit',p_same_team_limit);
exception when others then
  perform set_config('refassign.auto_assign', 'off', true);
  raise;
end;
$function$;

-- Keep older AutoAssign entry points aligned with the certification flag.
CREATE OR REPLACE FUNCTION public.run_organization_auto_assign(p_organization_id uuid, p_start_date date, p_end_date date, p_same_team_limit integer DEFAULT 1)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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
  if p_same_team_limit is null or p_same_team_limit < 1 or p_same_team_limit > 100 then
    raise exception 'The same-team assignment limit must be between 1 and 100.';
  end if;

  perform set_config('refassign.auto_assign', 'on', true);
  for v_game in
    select game.*, sport.name as sport_name
    from public.games game
    join public.sports sport on sport.id=game.sport_id
    where game.organization_id=p_organization_id
      and (game.starts_at at time zone 'America/Chicago')::date between p_start_date and p_end_date
      and lower(coalesce(game.status,'open')) not in ('cancelled','canceled','on hold','hold','rain out','rained out')
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
      if exists(select 1 from public.assignments assignment where assignment.game_id=v_game.id and assignment.position_id=v_pos.id and assignment.status<>'declined') then
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
      join public.organization_officials organization_official on organization_official.official_id=official.id and organization_official.organization_id=p_organization_id and organization_official.active
      left join public.official_rankings general_rank on general_rank.official_id=official.id
      left join public.official_soccer_position_rankings position_rank on position_rank.official_id=official.id
      left join public.official_mentor_certifications mentor on mentor.official_id=official.id
      where official.active
        and exists(select 1 from unnest(official.sports) official_sport where lower(official_sport)=lower(v_game.sport_name))
        and not exists(select 1 from public.assignments assignment where assignment.game_id=v_game.id and assignment.official_id=official.id and assignment.status<>'declined')
        and not exists(select 1 from public.assignment_declines decline where decline.game_id=v_game.id and decline.official_id=official.id)
        and (v_game.league_id is null or not exists(select 1 from public.official_league_eligibility eligibility where eligibility.official_id=official.id) or exists(select 1 from public.official_league_eligibility eligibility where eligibility.official_id=official.id and eligibility.league_id=v_game.league_id))
        and (v_game.level_id is null or not exists(select 1 from public.official_level_eligibility eligibility where eligibility.official_id=official.id) or exists(select 1 from public.official_level_eligibility eligibility where eligibility.official_id=official.id and eligibility.level_id=v_game.level_id))
        and not exists(select 1 from public.official_availability_blocks block where block.official_id=official.id and ((block.starts_at is not null and block.ends_at is not null and block.starts_at < v_game.starts_at + make_interval(mins=>coalesce(v_game.duration_minutes,110)) and block.ends_at > v_game.starts_at) or (block.block_type='date' and block.start_date is not null and block.end_date is not null and v_game_date between block.start_date and block.end_date) or (block.block_type='location' and block.location_id=v_game.location_id) or (block.block_type='team' and block.team_id in (v_game.home_team_id,v_game.away_team_id))))
        and not exists(select 1 from public.assignments assignment join public.games other_game on other_game.id=assignment.game_id where assignment.official_id=official.id and assignment.game_id<>v_game.id and assignment.status<>'declined' and lower(coalesce(other_game.status,'open')) not in ('cancelled','canceled','on hold','hold','rain out','rained out') and other_game.starts_at < v_game.starts_at + make_interval(mins=>coalesce(v_game.duration_minutes,110)) and other_game.starts_at + make_interval(mins=>coalesce(other_game.duration_minutes,110)) > v_game.starts_at)
        and (select count(*) from public.assignments assignment join public.games day_game on day_game.id=assignment.game_id where assignment.official_id=official.id and assignment.status<>'declined' and lower(coalesce(day_game.status,'open')) not in ('cancelled','canceled','on hold','hold','rain out','rained out') and (day_game.starts_at at time zone 'America/Chicago')::date=v_game_date) < coalesce(v_rule.max_games_per_day,2)
        and (coalesce(v_rule.rest_days,0)=0 or not exists(select 1 from public.assignments assignment join public.games rest_game on rest_game.id=assignment.game_id where assignment.official_id=official.id and assignment.status<>'declined' and assignment.position_id=v_pos.id and assignment.game_id<>v_game.id and rest_game.level_id is not distinct from v_game.level_id and abs((rest_game.starts_at at time zone 'America/Chicago')::date-v_game_date)<=v_rule.rest_days))
        and (coalesce(v_rule.same_team_days,0)=0 or not exists(select 1 from public.assignments assignment join public.games team_game on team_game.id=assignment.game_id where assignment.official_id=official.id and assignment.status<>'declined' and assignment.game_id<>v_game.id and abs((team_game.starts_at at time zone 'America/Chicago')::date-v_game_date)<=v_rule.same_team_days and ((v_game.home_team_id is not null and v_game.home_team_id in (team_game.home_team_id,team_game.away_team_id)) or (v_game.away_team_id is not null and v_game.away_team_id in (team_game.home_team_id,team_game.away_team_id)))))
        and (select count(*) from public.assignments assignment join public.games team_game on team_game.id=assignment.game_id where assignment.official_id=official.id and assignment.status<>'declined' and team_game.organization_id=p_organization_id and (team_game.starts_at at time zone 'America/Chicago')::date between p_start_date and p_end_date and ((v_game.home_team_id is not null and v_game.home_team_id in (team_game.home_team_id,team_game.away_team_id)) or (v_game.away_team_id is not null and v_game.away_team_id in (team_game.home_team_id,team_game.away_team_id)))) < p_same_team_limit
        and (lower(v_pos.name) not like '%mentor%' or coalesce(mentor.certified,false))
      order by case when lower(v_pos.name) like '%mentor%' then 1 when lower(v_pos.name) like '%assistant referee 1%' or lower(v_pos.name)='ar1' then coalesce(position_rank.ar1_rank,general_rank.rank,1) when lower(v_pos.name) like '%assistant referee 2%' or lower(v_pos.name)='ar2' then coalesce(position_rank.ar2_rank,general_rank.rank,1) when lower(v_pos.name) like '%4th%' or lower(v_pos.name) like '%fourth%' then coalesce(position_rank.fourth_rank,general_rank.rank,1) when lower(v_pos.name) like '%center%' or (lower(v_pos.name) like '%referee%' and lower(v_pos.name) not like '%assistant%') then coalesce(position_rank.ref_rank,general_rank.rank,1) else coalesce(general_rank.rank,1) end desc,
        (select count(*) from public.assignments assignment join public.games day_game on day_game.id=assignment.game_id where assignment.official_id=official.id and assignment.status<>'declined' and (day_game.starts_at at time zone 'America/Chicago')::date=v_game_date) asc,
        (select count(*) from public.assignments assignment join public.games recent_game on recent_game.id=assignment.game_id where assignment.official_id=official.id and assignment.status<>'declined' and recent_game.starts_at>=v_game.starts_at-interval '30 days' and recent_game.starts_at<v_game.starts_at) asc,
        official.last_name,official.first_name
      limit 1;

      if v_official_id is null then v_open:=v_open+1;
      else
        insert into public.assignments(game_id,official_id,position_id,status) values(v_game.id,v_official_id,v_pos.id,'proposed') on conflict do nothing;
        if found then v_assigned:=v_assigned+1; else v_open:=v_open+1; end if;
      end if;
      v_official_id:=null;
    end loop;
  end loop;
  perform set_config('refassign.auto_assign', 'off', true);
  return jsonb_build_object('games_processed',v_games,'assignments_created',v_assigned,'positions_left_open',v_open,'start_date',p_start_date,'end_date',p_end_date,'same_team_limit',p_same_team_limit);
exception when others then
  perform set_config('refassign.auto_assign', 'off', true);
  raise;
end;
$function$;
CREATE OR REPLACE FUNCTION public.run_auto_assign_core(p_start_date date, p_end_date date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_role text;
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
  select role into v_role from public.profiles where id=auth.uid();
  if v_role not in ('admin','assignor') then
    raise exception 'Only Administrators and Assignors can run AutoAssign';
  end if;
  if p_start_date is null or p_end_date is null or p_end_date < p_start_date then
    raise exception 'A valid AutoAssign date range is required';
  end if;

  for v_game in
    select g.*, s.name as sport_name
    from public.games g
    join public.sports s on s.id=g.sport_id
    where (g.starts_at at time zone 'America/Chicago')::date between p_start_date and p_end_date
      and lower(coalesce(g.status,'open')) not in ('cancelled','canceled')
    order by g.starts_at, g.game_number
  loop
    v_games := v_games + 1;
    v_game_date := (v_game.starts_at at time zone 'America/Chicago')::date;
    v_needed_positions := greatest(coalesce(v_game.officials_needed,1),0);

    for v_pos in
      select sp.*
      from public.sport_positions sp
      where sp.sport_id=v_game.sport_id
      order by sp.sort_order
      limit v_needed_positions
    loop
      if exists(select 1 from public.assignments a where a.game_id=v_game.id and a.position_id=v_pos.id) then
        continue;
      end if;

      select r.* into v_rule
      from public.auto_assign_rules r
      where r.position_id=v_pos.id
        and r.active=true
        and (r.level_id=v_game.level_id or r.level_id is null)
      order by case when r.level_id=v_game.level_id then 0 else 1 end
      limit 1;

      if not found then
        v_rule.max_games_per_day := 2;
        v_rule.rest_days := 0;
        v_rule.same_team_days := 7;
      end if;

      select o.id into v_official_id
      from public.officials o
      left join public.official_rankings gr on gr.official_id=o.id
      left join public.official_soccer_position_rankings pr on pr.official_id=o.id
      left join public.official_mentor_certifications mentor on mentor.official_id=o.id
      where o.active=true
        and exists(select 1 from unnest(o.sports) os where lower(os)=lower(v_game.sport_name))
        and not exists(select 1 from public.assignments a where a.game_id=v_game.id and a.official_id=o.id)
        and not exists(select 1 from public.assignment_declines d where d.game_id=v_game.id and d.official_id=o.id)
        and (v_game.league_id is null or not exists(select 1 from public.official_league_eligibility e where e.official_id=o.id) or exists(select 1 from public.official_league_eligibility e where e.official_id=o.id and e.league_id=v_game.league_id))
        and (v_game.level_id is null or not exists(select 1 from public.official_level_eligibility e where e.official_id=o.id) or exists(select 1 from public.official_level_eligibility e where e.official_id=o.id and e.level_id=v_game.level_id))
        and not exists(
          select 1 from public.official_availability_blocks b
          where b.official_id=o.id and (
            (b.starts_at is not null and b.ends_at is not null and b.starts_at < v_game.starts_at + make_interval(mins=>coalesce(v_game.duration_minutes,110)) and b.ends_at > v_game.starts_at)
            or (b.block_type='date' and b.start_date is not null and b.end_date is not null and v_game_date between b.start_date and b.end_date)
            or (b.block_type='location' and b.location_id is not null and b.location_id=v_game.location_id)
            or (b.block_type='team' and b.team_id is not null and b.team_id in (v_game.home_team_id,v_game.away_team_id))
          )
        )
        and not exists(
          select 1 from public.assignments a join public.games og on og.id=a.game_id
          where a.official_id=o.id and a.game_id<>v_game.id
            and lower(coalesce(og.status,'open')) not in ('cancelled','canceled')
            and og.starts_at < v_game.starts_at + make_interval(mins=>coalesce(v_game.duration_minutes,110))
            and og.starts_at + make_interval(mins=>coalesce(og.duration_minutes,110)) > v_game.starts_at
        )
        and (select count(*) from public.assignments a join public.games dg on dg.id=a.game_id where a.official_id=o.id and lower(coalesce(dg.status,'open')) not in ('cancelled','canceled') and (dg.starts_at at time zone 'America/Chicago')::date=v_game_date) < coalesce(v_rule.max_games_per_day,2)
        and (coalesce(v_rule.rest_days,0)=0 or not exists(select 1 from public.assignments a join public.games rg on rg.id=a.game_id where a.official_id=o.id and a.position_id=v_pos.id and a.game_id<>v_game.id and rg.level_id is not distinct from v_game.level_id and abs((rg.starts_at at time zone 'America/Chicago')::date-v_game_date)<=v_rule.rest_days))
        and (coalesce(v_rule.same_team_days,0)=0 or not exists(select 1 from public.assignments a join public.games tg on tg.id=a.game_id where a.official_id=o.id and a.game_id<>v_game.id and abs((tg.starts_at at time zone 'America/Chicago')::date-v_game_date)<=v_rule.same_team_days and ((v_game.home_team_id is not null and v_game.home_team_id in (tg.home_team_id,tg.away_team_id)) or (v_game.away_team_id is not null and v_game.away_team_id in (tg.home_team_id,tg.away_team_id)))))
        and (lower(v_pos.name) not like '%mentor%' or coalesce(mentor.certified,false))
      order by
        case
          when lower(v_pos.name) like '%mentor%' then 1
          when lower(v_pos.name) like '%assistant referee 1%' or lower(v_pos.name)='ar1' then coalesce(pr.ar1_rank,gr.rank,1)
          when lower(v_pos.name) like '%assistant referee 2%' or lower(v_pos.name)='ar2' then coalesce(pr.ar2_rank,gr.rank,1)
          when lower(v_pos.name) like '%4th%' or lower(v_pos.name) like '%fourth%' then coalesce(pr.fourth_rank,gr.rank,1)
          when lower(v_pos.name) like '%center%' or (lower(v_pos.name) like '%referee%' and lower(v_pos.name) not like '%assistant%') then coalesce(pr.ref_rank,gr.rank,1)
          else coalesce(gr.rank,1)
        end desc,
        (select count(*) from public.assignments a join public.games dg on dg.id=a.game_id where a.official_id=o.id and (dg.starts_at at time zone 'America/Chicago')::date=v_game_date) asc,
        (select count(*) from public.assignments a join public.games fg on fg.id=a.game_id where a.official_id=o.id and fg.starts_at>=v_game.starts_at-interval '30 days' and fg.starts_at<v_game.starts_at) asc,
        o.last_name,o.first_name
      limit 1;

      if v_official_id is null then
        v_open := v_open + 1;
      else
        insert into public.assignments(game_id,official_id,position_id,status)
        values(v_game.id,v_official_id,v_pos.id,'proposed')
        on conflict do nothing;
        if found then v_assigned := v_assigned + 1; else v_open := v_open + 1; end if;
      end if;
      v_official_id := null;
    end loop;
  end loop;

  return jsonb_build_object('games_processed',v_games,'assignments_created',v_assigned,'positions_left_open',v_open,'start_date',p_start_date,'end_date',p_end_date);
end;
$function$;

notify pgrst,'reload schema';
