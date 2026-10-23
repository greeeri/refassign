begin;
-- Stage only: existing organizations retain legacy behavior until separately
-- prepared and activated by an owner after the compatible UI is live.
create table private.personal_roster_settings (
 organization_id uuid primary key references public.organizations(id) on delete cascade,
 prepared_at timestamptz not null default now(),
 activated_at timestamptz,
 owner_wide boolean not null default true check(owner_wide)
);
create table public.assignor_official_rosters (
 organization_id uuid not null references public.organizations(id) on delete cascade,
 assignor_id uuid not null references auth.users(id) on delete cascade,
 official_id uuid not null references public.officials(id) on delete cascade,
 active boolean not null default true,
 updated_at timestamptz not null default now(),
 primary key(organization_id,assignor_id,official_id)
);
alter table private.personal_roster_settings enable row level security;
alter table public.assignor_official_rosters enable row level security;
-- Default privileges may include service_role writes. Explicitly revoke them.
revoke all on private.personal_roster_settings,public.assignor_official_rosters from public,anon,authenticated,service_role;
grant select on public.assignor_official_rosters to authenticated,service_role;
create policy "Read own or owner managed personal roster" on public.assignor_official_rosters for select to authenticated
 using(private.can_access_organization(organization_id) and
 (assignor_id=(select auth.uid()) or private.can_manage_organization(organization_id)));

create function private.personal_roster_manager(p_org uuid,p_user uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select p_user is not null and private.organization_has_operational_access(p_org) and
 (private.is_organization_owner_or_admin(p_org,p_user) or exists(
 select 1 from public.organization_memberships m join public.organization_member_league_access a using(organization_id,user_id)
 join public.organization_league_coverage c on c.organization_id=a.organization_id and c.league_id=a.league_id and c.active
 where m.organization_id=p_org and m.user_id=p_user and m.role in ('admin','assignor')));
$$;
create function private.personal_roster_target(p_org uuid,p_target uuid)
returns uuid language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=auth.uid(); target uuid:=coalesce(p_target,actor);
begin
 if actor is null or not private.personal_roster_manager(p_org,actor)
 or (target<>actor and not private.can_manage_organization(p_org))
 or not private.personal_roster_manager(p_org,target) then raise exception 'Not authorized to manage this personal roster'; end if;
 return target;
end $$;
-- Existing eligibility and organization membership remain authoritative. A
-- personal roster is a preference subset, never a grant of league/profile access.
create function private.personal_roster_official_allowed(p_org uuid,p_user uuid,p_official uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select private.personal_roster_manager(p_org,p_user) and exists(
 select 1 from public.organization_officials oo join public.officials o on o.id=oo.official_id
 where oo.organization_id=p_org and oo.official_id=p_official and oo.active and o.active
 and (private.is_organization_owner_or_admin(p_org,p_user) or exists(
 select 1 from public.official_league_eligibility e where e.official_id=o.id
 and private.can_manage_organization_league(p_org,e.league_id,p_user))));
$$;
create function private.get_personal_roster_state_impl(p_organization_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=auth.uid(); settings private.personal_roster_settings;
begin
 if actor is null or not private.can_access_organization(p_organization_id) then raise exception 'Not authorized'; end if;
 select * into settings from private.personal_roster_settings where organization_id=p_organization_id;
 return jsonb_build_object('prepared',settings.organization_id is not null,'enabled',settings.activated_at is not null,
 'owner_wide',private.is_organization_owner_or_admin(p_organization_id,actor),
 'can_manage',private.personal_roster_manager(p_organization_id,actor));
end $$;
create function public.get_personal_roster_state(p_organization_id uuid)
returns jsonb language sql stable security invoker set search_path='' as $$ select private.get_personal_roster_state_impl(p_organization_id) $$;

create function private.list_personal_roster_official_ids_impl(p_organization_id uuid,p_assignor_id uuid)
returns table(official_id uuid) language plpgsql stable security definer set search_path='' as $$
declare target uuid:=private.personal_roster_target(p_organization_id,p_assignor_id);
begin
 return query select r.official_id from public.assignor_official_rosters r
 where r.organization_id=p_organization_id and r.assignor_id=target and r.active
 and private.personal_roster_official_allowed(p_organization_id,target,r.official_id) order by r.official_id;
end $$;
create function public.list_personal_roster_official_ids(p_organization_id uuid,p_assignor_id uuid default null)
returns table(official_id uuid) language sql stable security invoker set search_path='' as $$ select * from private.list_personal_roster_official_ids_impl(p_organization_id,p_assignor_id) $$;

create function private.search_personal_roster_officials_impl(p_organization_id uuid,p_query text,p_assignor_id uuid)
returns table(official_id uuid,display_name text,email_hint text,in_roster boolean,match_exact boolean)
language plpgsql stable security definer set search_path='' as $$
declare target uuid:=private.personal_roster_target(p_organization_id,p_assignor_id); q text:=lower(trim(p_query));
begin
 if q is null or length(q)<2 or length(q)>200 then return; end if;
 return query select o.id,trim(concat_ws(' ',o.first_name,o.last_name)),
 case when nullif(o.email,'') is null then null else left(o.email,1)||'***@'||split_part(o.email,'@',2) end,
 exists(select 1 from public.assignor_official_rosters r where r.organization_id=p_organization_id and r.assignor_id=target and r.official_id=o.id and r.active),
 case when position('@' in q)>0 then lower(trim(o.email))=q else lower(regexp_replace(trim(concat_ws(' ',o.first_name,o.last_name)),'\s+',' ','g'))=regexp_replace(q,'\s+',' ','g') end
 from public.officials o where private.personal_roster_official_allowed(p_organization_id,target,o.id)
 and case when position('@' in q)>0 then lower(trim(o.email))=q else position(q in lower(trim(concat_ws(' ',o.first_name,o.last_name))))>0 end
 order by o.last_name,o.first_name,o.id limit 50;
end $$;
create function public.search_personal_roster_officials(p_organization_id uuid,p_query text,p_assignor_id uuid default null)
returns table(official_id uuid,display_name text,email_hint text,in_roster boolean,match_exact boolean)
language sql stable security invoker set search_path='' as $$ select * from private.search_personal_roster_officials_impl(p_organization_id,p_query,p_assignor_id) $$;

create function private.set_personal_roster_official_impl(p_organization_id uuid,p_official_id uuid,p_active boolean,p_assignor_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare target uuid:=private.personal_roster_target(p_organization_id,p_assignor_id);
begin
 if not exists(select 1 from private.personal_roster_settings where organization_id=p_organization_id) then raise exception 'Personal rosters are not prepared for this organization'; end if;
 if p_active is null then raise exception 'Choose add or remove'; end if;
 -- Removal is permitted after eligibility is revoked; it does not grant visibility.
 if p_active and not private.personal_roster_official_allowed(p_organization_id,target,p_official_id) then raise exception 'Official is not available within this assignor scope'; end if;
 if p_active then
 insert into public.assignor_official_rosters(organization_id,assignor_id,official_id,active) values(p_organization_id,target,p_official_id,true)
 on conflict(organization_id,assignor_id,official_id) do update set active=true,updated_at=now();
 else update public.assignor_official_rosters set active=false,updated_at=now() where organization_id=p_organization_id and assignor_id=target and official_id=p_official_id; end if;
end $$;
create function public.set_personal_roster_official(p_organization_id uuid,p_official_id uuid,p_active boolean,p_assignor_id uuid default null)
returns void language sql security invoker set search_path='' as $$ select private.set_personal_roster_official_impl(p_organization_id,p_official_id,p_active,p_assignor_id) $$;

create function private.list_personal_roster_assignors_impl(p_organization_id uuid)
returns table(user_id uuid,display_name text) language plpgsql stable security definer set search_path='' as $$
begin
 if not private.can_manage_organization(p_organization_id) then raise exception 'Only an organization owner can select another assignor'; end if;
 return query select distinct m.user_id,coalesce(nullif(trim(p.full_name),''),u.email::text,m.user_id::text)
 from public.organization_memberships m join auth.users u on u.id=m.user_id left join public.profiles p on p.id=m.user_id
 where m.organization_id=p_organization_id and m.role in ('admin','assignor') and private.personal_roster_manager(p_organization_id,m.user_id)
 and not private.is_organization_owner_or_admin(p_organization_id,m.user_id)
 and not exists(select 1 from public.protected_accounts pa where pa.user_id=m.user_id)
 order by 2,1;
end $$;
create function public.list_personal_roster_assignors(p_organization_id uuid)
returns table(user_id uuid,display_name text) language sql stable security invoker set search_path='' as $$ select * from private.list_personal_roster_assignors_impl(p_organization_id) $$;
create function private.set_personal_roster_officials_impl(p_organization_id uuid,p_official_ids uuid[],p_assignor_id uuid)
returns integer language plpgsql security definer set search_path='' as $$
declare target uuid; official uuid; n integer;
begin
 if not private.can_manage_organization(p_organization_id) then raise exception 'Only an organization owner can import a roster'; end if;
 target:=private.personal_roster_target(p_organization_id,p_assignor_id);
 if p_assignor_id is null or p_official_ids is null or cardinality(p_official_ids)>500 or array_position(p_official_ids,null) is not null then raise exception 'Select an assignor and at most 500 matched officials'; end if;
 -- Entire batch validates before any membership changes; any later error also
 -- rolls back the complete function call. No profiles, invitations or eligibility.
 foreach official in array p_official_ids loop
 if not private.personal_roster_official_allowed(p_organization_id,target,official) then raise exception 'One or more officials are outside this assignor scope'; end if;
 end loop;
 foreach official in array p_official_ids loop perform private.set_personal_roster_official_impl(p_organization_id,official,true,target); end loop;
 select count(distinct x)::integer into n from unnest(p_official_ids) x; return n;
end $$;
create function public.set_personal_roster_officials(p_organization_id uuid,p_official_ids uuid[],p_assignor_id uuid)
returns integer language sql security invoker set search_path='' as $$ select private.set_personal_roster_officials_impl(p_organization_id,p_official_ids,p_assignor_id) $$;

-- This predicate narrows candidates but never broadens the pre-existing game,
-- position, eligibility or RLS checks. No setting row = historical behavior.
create function private.personal_roster_candidate_allowed(p_org uuid,p_actor uuid,p_official uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select p_actor=(select auth.uid()) and (not exists(select 1 from private.personal_roster_settings where organization_id=p_org and activated_at is not null)
 or private.is_organization_owner_or_admin(p_org,p_actor)
 or exists(select 1 from public.assignor_official_rosters r where r.organization_id=p_org and r.assignor_id=p_actor and r.official_id=p_official and r.active));
$$;
create function private.guard_personal_roster_assignment()
returns trigger language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); org uuid;
begin
 -- Existing assignment/history maintenance (including cancellation restoration)
 -- is not a new candidate selection. Changing game/position/official is.
 if tg_op='UPDATE' and new.game_id is not distinct from old.game_id and new.official_id is not distinct from old.official_id and new.position_id is not distinct from old.position_id then return new; end if;
 select organization_id into org from public.games where id=new.game_id;
 -- Service calls are trusted server paths with no end-user JWT; their API handlers
 -- must check the authenticated actor's roster before choosing fresh candidates.
 if actor is null then return new; end if;
 -- Self-service officials retain existing self-assign authority, not manager power.
 if (not private.personal_roster_manager(org,actor) or to_jsonb(new)->>'assignment_source'='self_assign') and exists(select 1 from public.officials o where o.id=new.official_id and o.auth_user_id=actor) then return new; end if;
 if not private.personal_roster_candidate_allowed(org,actor,new.official_id) then raise exception 'Add this official to your personal roster before assigning'; end if;
 return new;
end $$;
create trigger personal_roster_assignment_guard before insert or update on public.assignments for each row execute function private.guard_personal_roster_assignment();

create function private.prepare_personal_rosters_impl(p_organization_id uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
 if not private.can_manage_organization(p_organization_id) then raise exception 'Only an organization owner can prepare personal rosters'; end if;
 insert into private.personal_roster_settings(organization_id) values(p_organization_id) on conflict do nothing;
end $$;
create function public.prepare_personal_rosters(p_organization_id uuid)
returns void language sql security invoker set search_path='' as $$ select private.prepare_personal_rosters_impl(p_organization_id) $$;
create function private.activate_personal_rosters_impl(p_organization_id uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
 if not private.can_manage_organization(p_organization_id) then raise exception 'Only an organization owner can activate personal rosters'; end if;
 if not exists(select 1 from private.personal_roster_settings where organization_id=p_organization_id) then raise exception 'Prepare personal rosters and deploy the compatible UI before activation'; end if;
 -- Existing Undo and its RLS are owner/protected-only via can_manage_organization.
 -- Owner-wide retains that pool. These exact reviewed dependency fingerprints
 -- fail closed if authority changes; do not silently invent immutable historical
 -- proof or rely on a client-set undo GUC to bypass the candidate guard.
 if (select md5(regexp_replace(prosrc,'\s+','','g')) from pg_proc where oid='private.can_manage_organization(uuid)'::regprocedure) is distinct from '5e9da87786a9fe42bd22fd8bc34e28d1'
 or (select md5(regexp_replace(prosrc,'\s+','','g')) from pg_proc where oid='private.is_organization_owner_or_admin(uuid,uuid)'::regprocedure) is distinct from '7cbba9ee45408fbc0f527bdee946cc70'
 or (select md5(regexp_replace(prosrc,'\s+','','g')) from pg_proc where oid='public.undo_operation(uuid,uuid)'::regprocedure) is distinct from '61b86397c9823e270ae411e73270df0a'
 or (select prosecdef from pg_proc where oid='public.undo_operation(uuid,uuid)'::regprocedure) then
 raise exception 'Undo authority changed; review immutable restoration proof before activation'; end if;
 update private.personal_roster_settings set activated_at=coalesce(activated_at,now()) where organization_id=p_organization_id;
end $$;
create function public.activate_personal_rosters(p_organization_id uuid)
returns void language sql security invoker set search_path='' as $$ select private.activate_personal_rosters_impl(p_organization_id) $$;

-- Every new function is a closed API unless explicitly listed here. Private
-- implementations check auth.uid even when called directly through SQL.
do $permissions$
declare f record;
begin
 for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where (n.nspname='private' and p.proname in ('personal_roster_manager','personal_roster_target','personal_roster_official_allowed','get_personal_roster_state_impl','list_personal_roster_official_ids_impl','search_personal_roster_officials_impl','set_personal_roster_official_impl','list_personal_roster_assignors_impl','set_personal_roster_officials_impl','personal_roster_candidate_allowed','guard_personal_roster_assignment','prepare_personal_rosters_impl','activate_personal_rosters_impl'))
 or (n.nspname='public' and p.proname in ('get_personal_roster_state','list_personal_roster_official_ids','search_personal_roster_officials','set_personal_roster_official','list_personal_roster_assignors','set_personal_roster_officials','prepare_personal_rosters','activate_personal_rosters')) loop
 execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);
 end loop;
end $permissions$;
grant execute on function public.get_personal_roster_state(uuid),private.get_personal_roster_state_impl(uuid),
 public.list_personal_roster_official_ids(uuid,uuid),private.list_personal_roster_official_ids_impl(uuid,uuid),
 public.search_personal_roster_officials(uuid,text,uuid),private.search_personal_roster_officials_impl(uuid,text,uuid),
 public.set_personal_roster_official(uuid,uuid,boolean,uuid),private.set_personal_roster_official_impl(uuid,uuid,boolean,uuid),
 public.list_personal_roster_assignors(uuid),private.list_personal_roster_assignors_impl(uuid),
 public.set_personal_roster_officials(uuid,uuid[],uuid),private.set_personal_roster_officials_impl(uuid,uuid[],uuid),
 public.prepare_personal_rosters(uuid),private.prepare_personal_rosters_impl(uuid),
 public.activate_personal_rosters(uuid),private.activate_personal_rosters_impl(uuid)
 to authenticated;

-- Preserve the complete existing AutoAssign query; narrow candidates before ranking.
CREATE OR REPLACE FUNCTION public.run_my_auto_assign(p_organization_id uuid, p_start_date date, p_end_date date, p_same_team_limit integer DEFAULT 1)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
 SET statement_timeout TO '120s'
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
  v_position_pass integer;
  v_max_position_pass integer;
begin
  if (select auth.uid()) is null or not private.can_manage_any_organization_league(p_organization_id) then
    raise exception 'Only an organization owner, administrator, or assignor can run AutoAssign.';
  end if;
  if p_start_date is null or p_end_date is null or p_end_date < p_start_date then
    raise exception 'A valid AutoAssign date range is required.';
  end if;
  if p_same_team_limit is null or p_same_team_limit < 1 or p_same_team_limit > 100 then
    raise exception 'The same-team assignment limit must be between 1 and 100.';
  end if;

  perform set_config('refassign.auto_assign', 'on', true);

  select coalesce(max(greatest(coalesce(game.officials_needed,1),0)),0)
    into v_max_position_pass
  from public.games game
  where game.organization_id=p_organization_id
    and game.league_id is not null
    and private.can_manage_organization_league_location(game.organization_id,game.league_id,game.location_id,auth.uid())
    and (game.starts_at at time zone 'America/Chicago')::date between p_start_date and p_end_date
    and lower(coalesce(game.status,'open')) not in ('cancelled','canceled','on hold','hold','rain out','rained out');

  for v_position_pass in 1..v_max_position_pass loop
  for v_game in
    select game.*, sport.name as sport_name
    from public.games game
    join public.sports sport on sport.id=game.sport_id
    left join public.assignor_team_power_rankings home_power on home_power.team_id=game.home_team_id and home_power.assignor_id=auth.uid()
    left join public.assignor_team_power_rankings away_power on away_power.team_id=game.away_team_id and away_power.assignor_id=auth.uid()
    where game.organization_id=p_organization_id
      and game.league_id is not null
      and private.can_manage_organization_league_location(game.organization_id,game.league_id,game.location_id,auth.uid())
      and (game.starts_at at time zone 'America/Chicago')::date between p_start_date and p_end_date
      and lower(coalesce(game.status,'open')) not in ('cancelled','canceled','on hold','hold','rain out','rained out')
    order by (coalesce(home_power.power,1)+coalesce(away_power.power,1))/2 desc,game.starts_at,game.game_number
  loop
    if v_position_pass=1 then v_games:=v_games+1; end if;
    v_game_date:=(v_game.starts_at at time zone 'America/Chicago')::date;
    v_needed_positions:=greatest(coalesce(v_game.officials_needed,1),0);

    for v_pos in
      select position.* from public.sport_positions position
      where position.sport_id=v_game.sport_id
      order by position.sort_order
      offset greatest(v_position_pass-1,0)
      limit 1
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
      join public.official_league_eligibility league_eligibility on league_eligibility.official_id=official.id and league_eligibility.league_id=v_game.league_id
      left join public.official_level_eligibility level_eligibility on level_eligibility.official_id=official.id and level_eligibility.level_id=v_game.level_id
      left join public.assignor_official_rankings general_rank on general_rank.official_id=official.id and general_rank.assignor_id=auth.uid()
      left join public.assignor_official_rankings position_rank on position_rank.official_id=official.id and position_rank.assignor_id=auth.uid()
      left join public.official_mentor_certifications mentor on mentor.official_id=official.id
      where official.active
        and private.personal_roster_candidate_allowed(p_organization_id,auth.uid(),official.id)
        and exists(select 1 from unnest(official.sports) official_sport where lower(official_sport)=lower(v_game.sport_name))
        and not exists(select 1 from public.assignments assignment where assignment.game_id=v_game.id and assignment.official_id=official.id and assignment.status<>'declined')
        and not exists(select 1 from public.assignment_declines decline where decline.game_id=v_game.id and decline.official_id=official.id)
        and (v_game.level_id is null or (level_eligibility.official_id is not null and case
        when lower(v_pos.name)='ar1' or lower(v_pos.name)='ar2' or lower(v_pos.name) like '%assistant referee%' then level_eligibility.ar_eligible
        when lower(v_pos.name) like '%center%' or (lower(v_pos.name) like '%referee%' and lower(v_pos.name) not like '%assistant%') then level_eligibility.center_eligible
        else true end))
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
  end loop;
  perform set_config('refassign.auto_assign', 'off', true);
  return jsonb_build_object('games_processed',v_games,'assignments_created',v_assigned,'positions_left_open',v_open,'start_date',p_start_date,'end_date',p_end_date,'same_team_limit',p_same_team_limit);
exception when others then
  perform set_config('refassign.auto_assign', 'off', true);
  raise;
end;
$function$;
revoke all on function public.run_my_auto_assign(uuid,date,date,integer) from public,anon;
grant execute on function public.run_my_auto_assign(uuid,date,date,integer),private.personal_roster_candidate_allowed(uuid,uuid,uuid) to authenticated;
commit;
