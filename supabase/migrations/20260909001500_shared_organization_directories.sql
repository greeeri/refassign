-- Shared master directories for organization setup records.
-- Organizations connect to canonical records instead of creating private duplicates.

create table if not exists public.organization_levels (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  level_id uuid not null references public.levels(id) on delete cascade,
  active boolean not null default true,
  added_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (organization_id, level_id)
);

create table if not exists public.organization_teams (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete cascade,
  active boolean not null default true,
  added_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (organization_id, team_id)
);

create index if not exists organization_levels_level_idx
  on public.organization_levels(level_id);
create index if not exists organization_levels_added_by_idx
  on public.organization_levels(added_by) where added_by is not null;
create index if not exists organization_teams_team_idx
  on public.organization_teams(team_id);
create index if not exists organization_teams_added_by_idx
  on public.organization_teams(added_by) where added_by is not null;
create index if not exists levels_directory_name_idx on public.levels(lower(trim(name)));
create index if not exists teams_directory_name_idx
  on public.teams(lower(trim(name)), sport_id, level_id);
create unique index if not exists leagues_directory_name_unique_idx
  on public.leagues(lower(trim(name)));
create unique index if not exists levels_directory_name_unique_idx
  on public.levels(lower(trim(name)));

alter table public.organization_levels enable row level security;
alter table public.organization_teams enable row level security;

create policy "Members read organization levels" on public.organization_levels
for select to authenticated using (private.can_access_organization(organization_id));
create policy "Managers manage organization levels" on public.organization_levels
for all to authenticated using (private.can_manage_organization(organization_id))
with check (private.can_manage_organization(organization_id));

create policy "Members read organization teams" on public.organization_teams
for select to authenticated using (private.can_access_organization(organization_id));
create policy "Managers manage organization teams" on public.organization_teams
for all to authenticated using (private.can_manage_organization(organization_id))
with check (private.can_manage_organization(organization_id));

drop policy if exists "Organization users read connected levels" on public.levels;
create policy "Organization users read connected levels" on public.levels
for select to authenticated using (
  exists (
    select 1 from public.organization_levels link
    where link.level_id=levels.id and link.active
      and private.can_access_organization(link.organization_id)
  )
);

drop policy if exists "Organization users read connected teams" on public.teams;
create policy "Organization users read connected teams" on public.teams
for select to authenticated using (
  exists (
    select 1 from public.organization_teams link
    where link.team_id=teams.id and link.active
      and private.can_access_organization(link.organization_id)
  )
);

-- Preserve existing ownership while introducing reusable many-to-many links.
insert into public.organization_teams(organization_id,team_id)
select organization_id,id from public.teams where organization_id is not null
on conflict(organization_id,team_id) do update set active=true;

insert into public.organization_levels(organization_id,level_id)
select distinct link.organization_id,team.level_id
from public.organization_teams link
join public.teams team on team.id=link.team_id
where team.level_id is not null
on conflict(organization_id,level_id) do update set active=true;

insert into public.organization_levels(organization_id,level_id)
select distinct organization_official.organization_id,eligibility.level_id
from public.organization_officials organization_official
join public.official_level_eligibility eligibility
  on eligibility.official_id=organization_official.official_id
where organization_official.active
on conflict(organization_id,level_id) do update set active=true;

do $$
declare v_organization_id uuid;
begin
  if (select count(*) from public.organizations)=1 then
    select id into v_organization_id from public.organizations limit 1;
    insert into public.organization_levels(organization_id,level_id)
    select v_organization_id,id from public.levels where active
    on conflict(organization_id,level_id) do update set active=true;
  end if;
end $$;

create or replace function private.get_organization_setup_directory_impl(p_organization_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if (select auth.uid()) is null or not private.can_access_organization(p_organization_id) then
    raise exception 'Not authorized.';
  end if;
  return jsonb_build_object(
    'leagues',coalesce((
      select jsonb_agg(jsonb_build_object('id',league.id,'name',league.name,'mileage_plan',league.mileage_plan) order by league.name)
      from public.organization_league_coverage link
      join public.leagues league on league.id=link.league_id
      where link.organization_id=p_organization_id and link.active and league.active
    ),'[]'::jsonb),
    'levels',coalesce((
      select jsonb_agg(jsonb_build_object('id',level.id,'name',level.name,'officials_needed',level.officials_needed) order by level.name)
      from public.organization_levels link
      join public.levels level on level.id=link.level_id
      where link.organization_id=p_organization_id and link.active and level.active
    ),'[]'::jsonb),
    'teams',coalesce((
      select jsonb_agg(jsonb_build_object('id',team.id,'name',team.name,'sport_id',team.sport_id,'level_id',team.level_id,'level',team.level) order by team.name)
      from public.organization_teams link
      join public.teams team on team.id=link.team_id
      where link.organization_id=p_organization_id and link.active and team.active
    ),'[]'::jsonb)
  );
end $$;

create or replace function public.get_organization_setup_directory(p_organization_id uuid)
returns jsonb language sql security invoker set search_path='' as $$
  select private.get_organization_setup_directory_impl(p_organization_id)
$$;

create or replace function private.search_shared_directory_impl(
  p_organization_id uuid,p_entity text,p_query text
) returns table(id uuid,name text,detail text,already_connected boolean)
language plpgsql security definer set search_path='' as $$
declare v_query text:=trim(coalesce(p_query,''));
begin
  if (select auth.uid()) is null or not private.can_manage_organization(p_organization_id) then
    raise exception 'Only organization owners, administrators, and assignors can search shared records.';
  end if;
  if length(v_query)<2 then return; end if;

  if p_entity='league' then
    return query
      select league.id,league.name,replace(initcap(league.mileage_plan),'_',' '),
        exists(select 1 from public.organization_league_coverage link where link.organization_id=p_organization_id and link.league_id=league.id and link.active)
      from public.leagues league
      where league.active and league.name ilike '%'||v_query||'%'
      order by case when lower(league.name)=lower(v_query) then 0 else 1 end,league.name limit 25;
  elsif p_entity='level' then
    return query
      select level.id,level.name,level.officials_needed||' officials per game',
        exists(select 1 from public.organization_levels link where link.organization_id=p_organization_id and link.level_id=level.id and link.active)
      from public.levels level
      where level.active and level.name ilike '%'||v_query||'%'
      order by case when lower(level.name)=lower(v_query) then 0 else 1 end,level.name limit 25;
  elsif p_entity='team' then
    return query
      select team.id,team.name,concat_ws(' · ',sport.name,level.name),
        exists(select 1 from public.organization_teams link where link.organization_id=p_organization_id and link.team_id=team.id and link.active)
      from public.teams team
      left join public.sports sport on sport.id=team.sport_id
      left join public.levels level on level.id=team.level_id
      where team.active and concat_ws(' ',team.name,sport.name,level.name) ilike '%'||v_query||'%'
      order by case when lower(team.name)=lower(v_query) then 0 else 1 end,team.name limit 25;
  elsif p_entity='official' then
    return query
      select official.id,
        coalesce(nullif(trim(concat_ws(' ',official.first_name,official.last_name)),''),official.full_name,'Official'),
        case when official.email is null then null else left(official.email,1)||'***@'||split_part(official.email,'@',2) end,
        exists(select 1 from public.organization_officials link where link.organization_id=p_organization_id and link.official_id=official.id and link.active)
      from public.officials official
      where official.active and concat_ws(' ',official.first_name,official.last_name,official.full_name,official.email) ilike '%'||v_query||'%'
      order by official.last_name,official.first_name limit 25;
  else
    raise exception 'Unsupported shared directory type.';
  end if;
end $$;

create or replace function public.search_shared_directory(
  p_organization_id uuid,p_entity text,p_query text
) returns table(id uuid,name text,detail text,already_connected boolean)
language sql security invoker set search_path='' as $$
  select * from private.search_shared_directory_impl(p_organization_id,p_entity,p_query)
$$;

create or replace function private.connect_shared_directory_record_impl(
  p_organization_id uuid,p_entity text,p_record_id uuid
) returns void language plpgsql security definer set search_path='' as $$
begin
  if (select auth.uid()) is null or not private.can_manage_organization(p_organization_id) then raise exception 'Not authorized.'; end if;
  if p_entity='league' then
    if not exists(select 1 from public.leagues where id=p_record_id and active) then raise exception 'League not found.'; end if;
    insert into public.organization_league_coverage(organization_id,league_id,coverage_type)
    values(p_organization_id,p_record_id,'All locations') on conflict do nothing;
    update public.organization_league_coverage set active=true
    where organization_id=p_organization_id and league_id=p_record_id;
  elsif p_entity='level' then
    if not exists(select 1 from public.levels where id=p_record_id and active) then raise exception 'Level not found.'; end if;
    insert into public.organization_levels(organization_id,level_id,added_by)
    values(p_organization_id,p_record_id,(select auth.uid()))
    on conflict(organization_id,level_id) do update set active=true;
  elsif p_entity='team' then
    if not exists(select 1 from public.teams where id=p_record_id and active) then raise exception 'Team not found.'; end if;
    insert into public.organization_teams(organization_id,team_id,added_by)
    values(p_organization_id,p_record_id,(select auth.uid()))
    on conflict(organization_id,team_id) do update set active=true;
  elsif p_entity='official' then
    if not exists(select 1 from public.officials where id=p_record_id and active) then raise exception 'Official not found.'; end if;
    insert into public.organization_officials(organization_id,official_id,added_by)
    values(p_organization_id,p_record_id,(select auth.uid()))
    on conflict(organization_id,official_id) do update set active=true;
  else raise exception 'Unsupported shared directory type.';
  end if;
end $$;

create or replace function public.connect_shared_directory_record(
  p_organization_id uuid,p_entity text,p_record_id uuid
) returns void language sql security invoker set search_path='' as $$
  select private.connect_shared_directory_record_impl(p_organization_id,p_entity,p_record_id)
$$;

create or replace function private.create_or_connect_organization_level_impl(
  p_organization_id uuid,p_name text,p_officials_needed integer
) returns uuid language plpgsql security definer set search_path='' as $$
declare v_id uuid;
begin
  if (select auth.uid()) is null or not private.can_manage_organization(p_organization_id) then raise exception 'Not authorized.'; end if;
  if length(trim(coalesce(p_name,'')))<1 then raise exception 'Level name is required.'; end if;
  if p_officials_needed not between 1 and 20 then raise exception 'Officials needed must be between 1 and 20.'; end if;
  select id into v_id from public.levels where lower(trim(name))=lower(trim(p_name)) limit 1;
  if v_id is null then
    insert into public.levels(name,officials_needed) values(trim(p_name),p_officials_needed) returning id into v_id;
  end if;
  insert into public.organization_levels(organization_id,level_id,added_by)
  values(p_organization_id,v_id,(select auth.uid()))
  on conflict(organization_id,level_id) do update set active=true;
  return v_id;
end $$;

create or replace function public.create_or_connect_organization_level(
  p_organization_id uuid,p_name text,p_officials_needed integer
) returns uuid language sql security invoker set search_path='' as $$
  select private.create_or_connect_organization_level_impl(p_organization_id,p_name,p_officials_needed)
$$;

create or replace function private.create_or_connect_organization_team_impl(
  p_organization_id uuid,p_name text,p_sport_id uuid,p_level_id uuid
) returns uuid language plpgsql security definer set search_path='' as $$
declare v_id uuid;v_level_name text;
begin
  if (select auth.uid()) is null or not private.can_manage_organization(p_organization_id) then raise exception 'Not authorized.'; end if;
  if length(trim(coalesce(p_name,'')))<1 then raise exception 'Team name is required.'; end if;
  if not exists(select 1 from public.sports where id=p_sport_id and active) then raise exception 'Sport not found.'; end if;
  select name into v_level_name from public.levels where id=p_level_id and active;
  if v_level_name is null then raise exception 'Level not found.'; end if;
  if not exists(select 1 from public.organization_levels where organization_id=p_organization_id and level_id=p_level_id and active) then
    raise exception 'Connect the level to this organization first.';
  end if;
  select id into v_id from public.teams
  where lower(trim(name))=lower(trim(p_name)) and sport_id=p_sport_id and level_id=p_level_id
  order by id limit 1;
  if v_id is null then
    insert into public.teams(name,sport_id,level_id,level,organization_id)
    values(trim(p_name),p_sport_id,p_level_id,v_level_name,null) returning id into v_id;
  end if;
  insert into public.organization_teams(organization_id,team_id,added_by)
  values(p_organization_id,v_id,(select auth.uid()))
  on conflict(organization_id,team_id) do update set active=true;
  return v_id;
end $$;

create or replace function public.create_or_connect_organization_team(
  p_organization_id uuid,p_name text,p_sport_id uuid,p_level_id uuid
) returns uuid language sql security invoker set search_path='' as $$
  select private.create_or_connect_organization_team_impl(p_organization_id,p_name,p_sport_id,p_level_id)
$$;

create or replace function private.disconnect_shared_directory_record_impl(
  p_organization_id uuid,p_entity text,p_record_id uuid
) returns void language plpgsql security definer set search_path='' as $$
begin
  if (select auth.uid()) is null or not private.can_manage_organization(p_organization_id) then raise exception 'Not authorized.'; end if;
  if p_entity='league' then
    update public.organization_league_coverage set active=false where organization_id=p_organization_id and league_id=p_record_id;
  elsif p_entity='level' then
    if exists(select 1 from public.organization_teams link join public.teams team on team.id=link.team_id where link.organization_id=p_organization_id and link.active and team.level_id=p_record_id) then
      raise exception 'Disconnect teams using this level first.';
    end if;
    update public.organization_levels set active=false where organization_id=p_organization_id and level_id=p_record_id;
  elsif p_entity='team' then
    update public.organization_teams set active=false where organization_id=p_organization_id and team_id=p_record_id;
  elsif p_entity='official' then
    update public.organization_officials set active=false where organization_id=p_organization_id and official_id=p_record_id;
  else raise exception 'Unsupported shared directory type.';
  end if;
end $$;

create or replace function public.disconnect_shared_directory_record(
  p_organization_id uuid,p_entity text,p_record_id uuid
) returns void language sql security invoker set search_path='' as $$
  select private.disconnect_shared_directory_record_impl(p_organization_id,p_entity,p_record_id)
$$;

revoke all on table public.organization_levels,public.organization_teams from anon;
grant select,insert,update,delete on table public.organization_levels,public.organization_teams to authenticated,service_role;

revoke all on function private.get_organization_setup_directory_impl(uuid) from public,anon,authenticated;
revoke all on function private.search_shared_directory_impl(uuid,text,text) from public,anon,authenticated;
revoke all on function private.connect_shared_directory_record_impl(uuid,text,uuid) from public,anon,authenticated;
revoke all on function private.create_or_connect_organization_level_impl(uuid,text,integer) from public,anon,authenticated;
revoke all on function private.create_or_connect_organization_team_impl(uuid,text,uuid,uuid) from public,anon,authenticated;
revoke all on function private.disconnect_shared_directory_record_impl(uuid,text,uuid) from public,anon,authenticated;

grant execute on function private.get_organization_setup_directory_impl(uuid) to authenticated,service_role;
grant execute on function private.search_shared_directory_impl(uuid,text,text) to authenticated,service_role;
grant execute on function private.connect_shared_directory_record_impl(uuid,text,uuid) to authenticated,service_role;
grant execute on function private.create_or_connect_organization_level_impl(uuid,text,integer) to authenticated,service_role;
grant execute on function private.create_or_connect_organization_team_impl(uuid,text,uuid,uuid) to authenticated,service_role;
grant execute on function private.disconnect_shared_directory_record_impl(uuid,text,uuid) to authenticated,service_role;

revoke all on function public.get_organization_setup_directory(uuid) from public,anon;
revoke all on function public.search_shared_directory(uuid,text,text) from public,anon;
revoke all on function public.connect_shared_directory_record(uuid,text,uuid) from public,anon;
revoke all on function public.create_or_connect_organization_level(uuid,text,integer) from public,anon;
revoke all on function public.create_or_connect_organization_team(uuid,text,uuid,uuid) from public,anon;
revoke all on function public.disconnect_shared_directory_record(uuid,text,uuid) from public,anon;

grant execute on function public.get_organization_setup_directory(uuid) to authenticated,service_role;
grant execute on function public.search_shared_directory(uuid,text,text) to authenticated,service_role;
grant execute on function public.connect_shared_directory_record(uuid,text,uuid) to authenticated,service_role;
grant execute on function public.create_or_connect_organization_level(uuid,text,integer) to authenticated,service_role;
grant execute on function public.create_or_connect_organization_team(uuid,text,uuid,uuid) to authenticated,service_role;
grant execute on function public.disconnect_shared_directory_record(uuid,text,uuid) to authenticated,service_role;
