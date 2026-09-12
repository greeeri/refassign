-- Ratings belong to the signed-in assignor, independent of organization.
-- Legacy tables are retained as a one-time migration source, never a live fallback.
create table public.assignor_official_rankings (
  assignor_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  official_id uuid not null references public.officials(id) on delete cascade,
  rank numeric(3,1) not null default 1 check (rank between 1 and 10),
  ref_rank numeric(3,1) not null default 1 check (ref_rank between 1 and 10),
  ar1_rank numeric(3,1) not null default 1 check (ar1_rank between 1 and 10),
  ar2_rank numeric(3,1) not null default 1 check (ar2_rank between 1 and 10),
  fourth_rank numeric(3,1) not null default 1 check (fourth_rank between 1 and 10),
  mentor_rank numeric(3,1) not null default 1 check (mentor_rank between 1 and 10),
  updated_at timestamptz not null default now(),
  primary key (assignor_id, official_id)
);
create index assignor_official_rankings_official_idx on public.assignor_official_rankings(official_id);

create table public.assignor_team_power_rankings (
  assignor_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete cascade,
  power numeric(3,1) not null default 1 check (power between 1 and 10),
  updated_at timestamptz not null default now(),
  primary key (assignor_id, team_id)
);
create index assignor_team_power_rankings_team_idx on public.assignor_team_power_rankings(team_id);

-- Definer helpers inspect membership without recursive RLS. They never accept
-- an arbitrary user ID; authority always comes from the caller's auth.uid().
create function private.can_rank_official(p_official_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select (select auth.uid()) is not null and (
    public.is_super_admin()
    or exists (
      select 1 from public.organization_officials link
      join public.organization_memberships membership using (organization_id)
      where link.official_id=p_official_id and link.active
        and membership.user_id=(select auth.uid())
        and membership.role in ('owner','admin','assignor')
        and private.can_access_organization(link.organization_id)
    )
    or (public.can_manage_rank() and not exists (
      select 1 from public.organization_officials link where link.official_id=p_official_id and link.active
    ))
  );
$$;
create function private.can_rank_team(p_team_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select (select auth.uid()) is not null and (
    public.is_super_admin()
    or exists (
      select 1 from public.organization_teams link
      join public.organization_memberships membership using (organization_id)
      where link.team_id=p_team_id and link.active
        and membership.user_id=(select auth.uid())
        and membership.role in ('owner','admin','assignor')
        and private.can_access_organization(link.organization_id)
    )
    or (public.can_manage_rank() and not exists (
      select 1 from public.organization_teams link where link.team_id=p_team_id and link.active
    ))
  );
$$;
revoke all on function private.can_rank_official(uuid), private.can_rank_team(uuid) from public, anon;
grant execute on function private.can_rank_official(uuid), private.can_rank_team(uuid) to authenticated;

-- Organization assignors can already use the connected-official directory RPC.
-- Give the invoker AutoAssign query the same scoped read access; do not bypass RLS.
create policy "Organization managers read connected officials for ranking"
on public.officials for select to authenticated
using (private.can_rank_official(id));

create policy "Organization assignors read sport catalogue"
on public.sports for select to authenticated
using (exists (
  select 1 from public.organization_memberships membership
  where membership.user_id=(select auth.uid()) and membership.role in ('owner','admin','assignor')
    and private.can_access_organization(membership.organization_id)
));

alter table public.assignor_official_rankings enable row level security;
alter table public.assignor_team_power_rankings enable row level security;
revoke all on public.assignor_official_rankings, public.assignor_team_power_rankings from public, anon, authenticated;
grant select, insert, update, delete on public.assignor_official_rankings, public.assignor_team_power_rankings to authenticated;

create policy "Assignors manage only their own official ratings"
on public.assignor_official_rankings for all to authenticated
using (assignor_id=(select auth.uid()) and private.can_rank_official(official_id))
with check (assignor_id=(select auth.uid()) and private.can_rank_official(official_id));
create policy "Assignors manage only their own team ratings"
on public.assignor_team_power_rankings for all to authenticated
using (assignor_id=(select auth.uid()) and private.can_rank_team(team_id))
with check (assignor_id=(select auth.uid()) and private.can_rank_team(team_id));

-- Copy current values once for existing managers of each connected entity.
-- DISTINCT avoids duplicate rows for assignors belonging to multiple organizations.
insert into public.assignor_official_rankings
  (assignor_id,official_id,rank,ref_rank,ar1_rank,ar2_rank,fourth_rank,mentor_rank)
select distinct membership.user_id,link.official_id,coalesce(general.rank,1),
  coalesce(position.ref_rank,1),coalesce(position.ar1_rank,1),coalesce(position.ar2_rank,1),
  coalesce(position.fourth_rank,1),coalesce(position.mentor_rank,1)
from public.organization_officials link
join public.organization_memberships membership using (organization_id)
left join public.official_rankings general on general.official_id=link.official_id
left join public.official_soccer_position_rankings position on position.official_id=link.official_id
where link.active and membership.role in ('owner','admin','assignor')
on conflict do nothing;

insert into public.assignor_team_power_rankings(assignor_id,team_id,power)
select distinct membership.user_id,link.team_id,coalesce(power.power,1)
from public.organization_teams link
join public.organization_memberships membership using (organization_id)
left join public.team_power_rankings power on power.team_id=link.team_id
where link.active and membership.role in ('owner','admin','assignor')
on conflict do nothing;

create function public.set_my_team_power(p_team_id uuid, p_power numeric)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Sign in to save your rankings' using errcode='42501'; end if;
  if p_power is null or p_power not between 1 and 10 then raise exception 'Power must be between 1 and 10'; end if;
  insert into public.assignor_team_power_rankings(assignor_id,team_id,power,updated_at)
  values(auth.uid(),p_team_id,p_power,now())
  on conflict(assignor_id,team_id) do update set power=excluded.power,updated_at=now();
end;
$$;
create function public.set_my_official_rankings(
  p_official_id uuid, p_rank numeric, p_ref_rank numeric, p_ar1_rank numeric,
  p_ar2_rank numeric, p_fourth_rank numeric, p_mentor_rank numeric
)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Sign in to save your rankings' using errcode='42501'; end if;
  if exists (select 1 from unnest(array[p_rank,p_ref_rank,p_ar1_rank,p_ar2_rank,p_fourth_rank,p_mentor_rank]) value
    where value is null or value not between 1 and 10) then
    raise exception 'All rankings must be between 1 and 10';
  end if;
  insert into public.assignor_official_rankings(assignor_id,official_id,rank,ref_rank,ar1_rank,ar2_rank,fourth_rank,mentor_rank,updated_at)
  values(auth.uid(),p_official_id,p_rank,p_ref_rank,p_ar1_rank,p_ar2_rank,p_fourth_rank,p_mentor_rank,now())
  on conflict(assignor_id,official_id) do update set rank=excluded.rank,ref_rank=excluded.ref_rank,
    ar1_rank=excluded.ar1_rank,ar2_rank=excluded.ar2_rank,fourth_rank=excluded.fourth_rank,
    mentor_rank=excluded.mentor_rank,updated_at=now();
end;
$$;
revoke all on function public.set_my_team_power(uuid,numeric), public.set_my_official_rankings(uuid,numeric,numeric,numeric,numeric,numeric,numeric) from public, anon;
grant execute on function public.set_my_team_power(uuid,numeric), public.set_my_official_rankings(uuid,numeric,numeric,numeric,numeric,numeric,numeric) to authenticated;

comment on table public.assignor_official_rankings is 'Private general and position ratings owned by each assignor; never shared across assignors.';
comment on table public.assignor_team_power_rankings is 'Private team power ratings owned by each assignor, reused across their organizations.';

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
        and (lower(v_pos.name) not like '%mentor%' or coalesce(position_rank.mentor_rank,1)>1)
      order by case when lower(v_pos.name) like '%mentor%' then coalesce(position_rank.mentor_rank,general_rank.rank,1) when lower(v_pos.name) like '%assistant referee 1%' or lower(v_pos.name)='ar1' then coalesce(position_rank.ar1_rank,general_rank.rank,1) when lower(v_pos.name) like '%assistant referee 2%' or lower(v_pos.name)='ar2' then coalesce(position_rank.ar2_rank,general_rank.rank,1) when lower(v_pos.name) like '%4th%' or lower(v_pos.name) like '%fourth%' then coalesce(position_rank.fourth_rank,general_rank.rank,1) when lower(v_pos.name) like '%center%' or (lower(v_pos.name) like '%referee%' and lower(v_pos.name) not like '%assistant%') then coalesce(position_rank.ref_rank,general_rank.rank,1) else coalesce(general_rank.rank,1) end desc,
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


revoke all on function public.run_my_auto_assign(uuid,date,date,integer) from public,anon;
grant execute on function public.run_my_auto_assign(uuid,date,date,integer) to authenticated;

CREATE OR REPLACE FUNCTION private.upsert_my_official_roster_row(p_organization_id uuid, p_supplied_id text, p_first_name text, p_last_name text, p_email text, p_phone text, p_home_address text, p_home_city text, p_home_state text, p_home_zip text, p_sports text[], p_certification text, p_active boolean, p_ref_rank numeric, p_ar1_rank numeric, p_ar2_rank numeric, p_fourth_rank numeric, p_league_ids uuid[], p_level_ids uuid[], p_college_license text DEFAULT NULL::text, p_high_school_license text DEFAULT NULL::text, p_us_soccer_license text DEFAULT NULL::text)
 RETURNS TABLE(result_official_id uuid, result_action text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_id uuid;
  v_action text;
  v_shared boolean := false;
begin
  if auth.uid() is null or not (private.can_access_organization(p_organization_id) and exists (select 1 from public.organization_memberships m where m.organization_id=p_organization_id and m.user_id=auth.uid() and m.role in ('owner','admin','assignor'))) then
    raise exception 'You cannot import officials for this organization' using errcode = '42501';
  end if;
  if p_first_name is null or btrim(p_first_name) = '' then raise exception 'Column first_name: missing value'; end if;
  if p_last_name is null or btrim(p_last_name) = '' then raise exception 'Column last_name: missing value'; end if;
  if p_ref_rank not between 1 and 10 then raise exception 'Column ref_rank: must be 1.0-10.0'; end if;
  if p_ar1_rank not between 1 and 10 then raise exception 'Column ar1_rank: must be 1.0-10.0'; end if;
  if p_ar2_rank not between 1 and 10 then raise exception 'Column ar2_rank: must be 1.0-10.0'; end if;
  if p_fourth_rank not between 1 and 10 then raise exception 'Column fourth_rank: must be 1.0-10.0'; end if;
  if exists (
    select 1 from unnest(coalesce(p_league_ids, '{}'::uuid[])) candidate(league_id)
    where not exists (
      select 1 from public.organization_league_coverage coverage
      where coverage.organization_id = p_organization_id
        and coverage.league_id = candidate.league_id and coverage.active
    )
  ) then raise exception 'Column leagues: one or more leagues are not active for this organization'; end if;
  if exists (
    select 1 from unnest(coalesce(p_level_ids, '{}'::uuid[])) candidate(level_id)
    where not exists (
      select 1 from public.organization_levels organization_level
      where organization_level.organization_id = p_organization_id
        and organization_level.level_id = candidate.level_id and organization_level.active
    )
  ) then raise exception 'Column levels: one or more levels are not active for this organization'; end if;

  begin
    if nullif(btrim(coalesce(p_supplied_id, '')), '') is not null then
      select o.id into v_id from public.officials o where o.id = p_supplied_id::uuid;
    end if;
  exception when invalid_text_representation then v_id := null;
  end;
  if v_id is null and nullif(btrim(coalesce(p_email, '')), '') is not null then
    select o.id into v_id from public.officials o where lower(btrim(o.email)) = lower(btrim(p_email)) limit 1;
  end if;
  if v_id is null then
    select o.id into v_id from public.officials o
    where lower(btrim(o.first_name)) = lower(btrim(p_first_name))
      and lower(btrim(o.last_name)) = lower(btrim(p_last_name)) limit 1;
  end if;

  if v_id is null then
    insert into public.officials(
      first_name,last_name,email,phone,home_address,home_city,home_state,home_zip,
      sports,certification_level,college_license_level,high_school_license_level,
      us_soccer_license_level,active
    ) values (
      btrim(p_first_name),btrim(p_last_name),nullif(btrim(coalesce(p_email,'')),''),
      nullif(btrim(coalesce(p_phone,'')),''),nullif(btrim(coalesce(p_home_address,'')),''),
      nullif(btrim(coalesce(p_home_city,'')),''),nullif(btrim(coalesce(p_home_state,'')),''),
      nullif(btrim(coalesce(p_home_zip,'')),''),coalesce(p_sports,array['Soccer']::text[]),
      nullif(btrim(coalesce(p_certification,'')),''),nullif(btrim(coalesce(p_college_license,'')),''),
      nullif(btrim(coalesce(p_high_school_license,'')),''),nullif(btrim(coalesce(p_us_soccer_license,'')),''),
      coalesce(p_active,true)
    ) returning id into v_id;
    v_action := 'Add';
  else
    select exists (
      select 1 from public.organization_officials link
      where link.official_id = v_id and link.organization_id <> p_organization_id
    ) into v_shared;
    if v_shared then
      v_action := 'Connect';
    else
      update public.officials o set
        first_name=btrim(p_first_name), last_name=btrim(p_last_name),
        email=nullif(btrim(coalesce(p_email,'')),''), phone=nullif(btrim(coalesce(p_phone,'')),''),
        home_address=nullif(btrim(coalesce(p_home_address,'')),''), home_city=nullif(btrim(coalesce(p_home_city,'')),''),
        home_state=nullif(btrim(coalesce(p_home_state,'')),''), home_zip=nullif(btrim(coalesce(p_home_zip,'')),''),
        sports=coalesce(p_sports,array['Soccer']::text[]), certification_level=nullif(btrim(coalesce(p_certification,'')),''),
        college_license_level=nullif(btrim(coalesce(p_college_license,'')),''),
        high_school_license_level=nullif(btrim(coalesce(p_high_school_license,'')),''),
        us_soccer_license_level=nullif(btrim(coalesce(p_us_soccer_license,'')),''),
        active=coalesce(p_active,true), updated_at=now()
      where o.id=v_id;
      v_action := 'Update';
    end if;
  end if;

  insert into public.organization_officials(organization_id,official_id,active,added_by)
  values(p_organization_id,v_id,true,auth.uid())
  on conflict(organization_id,official_id) do update set active=true;

  -- Personal ratings are saved even when the official is shared with another organization.
  -- Ownership is server-derived because this roster function runs as a definer.
  insert into public.assignor_official_rankings(assignor_id,official_id,ref_rank,ar1_rank,ar2_rank,fourth_rank,updated_at)
  values(auth.uid(),v_id,p_ref_rank,p_ar1_rank,p_ar2_rank,p_fourth_rank,now())
  on conflict(assignor_id,official_id) do update set ref_rank=excluded.ref_rank,ar1_rank=excluded.ar1_rank,
    ar2_rank=excluded.ar2_rank,fourth_rank=excluded.fourth_rank,updated_at=now();
  if not v_shared then
    delete from public.official_league_eligibility where official_id=v_id;
    insert into public.official_league_eligibility(official_id,league_id)
      select v_id,x from (select distinct unnest(coalesce(p_league_ids,'{}'::uuid[])) x) d;
    delete from public.official_level_eligibility where official_id=v_id;
    insert into public.official_level_eligibility(official_id,level_id)
      select v_id,x from (select distinct unnest(coalesce(p_level_ids,'{}'::uuid[])) x) d;
  end if;
  result_official_id := v_id; result_action := v_action; return next;
end;
$function$;


revoke all on function private.upsert_my_official_roster_row(uuid,text,text,text,text,text,text,text,text,text,text[],text,boolean,numeric,numeric,numeric,numeric,uuid[],uuid[],text,text,text) from public,anon;
grant execute on function private.upsert_my_official_roster_row(uuid,text,text,text,text,text,text,text,text,text,text[],text,boolean,numeric,numeric,numeric,numeric,uuid[],uuid[],text,text,text) to authenticated;

CREATE OR REPLACE FUNCTION public.upsert_my_official_roster_row(p_organization_id uuid, p_supplied_id text, p_first_name text, p_last_name text, p_email text, p_phone text, p_home_address text, p_home_city text, p_home_state text, p_home_zip text, p_sports text[], p_certification text, p_active boolean, p_ref_rank numeric, p_ar1_rank numeric, p_ar2_rank numeric, p_fourth_rank numeric, p_league_ids uuid[], p_level_ids uuid[], p_college_license text DEFAULT NULL::text, p_high_school_license text DEFAULT NULL::text, p_us_soccer_license text DEFAULT NULL::text)
 RETURNS TABLE(result_official_id uuid, result_action text)
 LANGUAGE sql
 SECURITY INVOKER
 SET search_path TO ''
AS $$
  select * from private.upsert_my_official_roster_row(p_organization_id,p_supplied_id,p_first_name,p_last_name,p_email,p_phone,p_home_address,p_home_city,p_home_state,p_home_zip,p_sports,p_certification,p_active,p_ref_rank,p_ar1_rank,p_ar2_rank,p_fourth_rank,p_league_ids,p_level_ids,p_college_license,p_high_school_license,p_us_soccer_license);
$$;
revoke all on function public.upsert_my_official_roster_row(uuid,text,text,text,text,text,text,text,text,text,text[],text,boolean,numeric,numeric,numeric,numeric,uuid[],uuid[],text,text,text) from public,anon;
grant execute on function public.upsert_my_official_roster_row(uuid,text,text,text,text,text,text,text,text,text,text[],text,boolean,numeric,numeric,numeric,numeric,uuid[],uuid[],text,text,text) to authenticated;

notify pgrst, 'reload schema';
