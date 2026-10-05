-- An absent configuration preserves existing organization-wide team options.
create table private.organization_league_team_settings (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  league_id uuid not null references public.leagues(id) on delete cascade,
  team_ids uuid[] not null default '{}',
  primary key (organization_id, league_id)
);
alter table private.organization_league_team_settings enable row level security;
revoke all on private.organization_league_team_settings from public, anon, authenticated;

create function private.get_organization_league_teams_impl(p_organization_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if (select auth.uid()) is null or not private.can_access_organization(p_organization_id) then
    raise exception 'Not authorized.' using errcode='42501';
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object('league_id',s.league_id,'team_ids',s.team_ids))
    from private.organization_league_team_settings s
    where s.organization_id=p_organization_id
      and (public.is_super_admin() or private.can_access_organization_league(p_organization_id,s.league_id,(select auth.uid())))), '[]'::jsonb);
end $$;

create function public.get_organization_league_teams(p_organization_id uuid)
returns jsonb language sql security invoker set search_path='' as $$
  select private.get_organization_league_teams_impl(p_organization_id)
$$;

create function private.save_organization_league_teams_impl(p_organization_id uuid,p_league_id uuid,p_team_ids uuid[])
returns boolean language plpgsql security definer set search_path='' as $$
begin
  if (select auth.uid()) is null or not private.can_manage_organization_league_settings(p_organization_id,p_league_id) then
    raise exception 'You may update only leagues assigned to you.' using errcode='42501';
  end if;
  if p_team_ids is null or exists (
    select 1 from unnest(p_team_ids) selected(team_id) where selected.team_id is null or not exists (
      select 1 from public.organization_teams ol join public.teams l on l.id=ol.team_id
      where ol.organization_id=p_organization_id and ol.team_id=selected.team_id and ol.active and l.active
    )
  ) then raise exception 'Choose active teams connected to this organization.'; end if;
  insert into private.organization_league_team_settings values (p_organization_id,p_league_id,array(select distinct unnest(p_team_ids)))
  on conflict (organization_id,league_id) do update set team_ids=excluded.team_ids;
  return true;
end $$;

create function public.save_organization_league_teams(p_organization_id uuid,p_league_id uuid,p_team_ids uuid[])
returns boolean language sql security invoker set search_path='' as $$
  select private.save_organization_league_teams_impl(p_organization_id,p_league_id,p_team_ids)
$$;

revoke all on function private.get_organization_league_teams_impl(uuid), private.save_organization_league_teams_impl(uuid,uuid,uuid[]),
 public.get_organization_league_teams(uuid),public.save_organization_league_teams(uuid,uuid,uuid[]) from public,anon;
grant execute on function private.get_organization_league_teams_impl(uuid),private.save_organization_league_teams_impl(uuid,uuid,uuid[]),
 public.get_organization_league_teams(uuid),public.save_organization_league_teams(uuid,uuid,uuid[]) to authenticated,service_role;

-- Preserve historical crews/games while validating newly selected teams.
create function private.check_game_league_teams() returns trigger
language plpgsql security definer set search_path='' as $$
declare selected_ids uuid[]; same_scope boolean := false;
begin
  if TG_OP='UPDATE' then
    same_scope := new.organization_id is not distinct from old.organization_id and new.league_id is not distinct from old.league_id;
  end if;
  select team_ids into selected_ids from private.organization_league_team_settings
    where organization_id=new.organization_id and league_id=new.league_id;
  if not found then return new; end if;
  if new.home_team_id is not null and not(new.home_team_id=any(selected_ids)) then
    if TG_OP='INSERT' then
      raise exception 'Home team is not selected for this league. Update Games – Teams or select an enabled team.' using errcode='23514';
    elsif not same_scope or new.home_team_id is distinct from old.home_team_id then
      raise exception 'Home team is not selected for this league. Update Games – Teams or select an enabled team.' using errcode='23514';
    end if;
  end if;
  if new.away_team_id is not null and not(new.away_team_id=any(selected_ids)) then
    if TG_OP='INSERT' then
      raise exception 'Away team is not selected for this league. Update Games – Teams or select an enabled team.' using errcode='23514';
    elsif not same_scope or new.away_team_id is distinct from old.away_team_id then
      raise exception 'Away team is not selected for this league. Update Games – Teams or select an enabled team.' using errcode='23514';
    end if;
  end if;
  return new;
end $$;
revoke all on function private.check_game_league_teams() from public,anon,authenticated;
create trigger games_check_league_teams before insert or update of organization_id,league_id,home_team_id,away_team_id on public.games
for each row execute function private.check_game_league_teams();
