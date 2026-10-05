-- An absent configuration preserves the existing organization-wide options.
create table private.organization_league_level_settings (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  league_id uuid not null references public.leagues(id) on delete cascade,
  level_ids uuid[] not null default '{}',
  primary key (organization_id, league_id)
);
alter table private.organization_league_level_settings enable row level security;
revoke all on private.organization_league_level_settings from public, anon, authenticated;

create function private.get_organization_league_levels_impl(p_organization_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if (select auth.uid()) is null or not private.can_access_organization(p_organization_id) then
    raise exception 'Not authorized.' using errcode='42501';
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object('league_id',s.league_id,'level_ids',s.level_ids))
    from private.organization_league_level_settings s
    where s.organization_id=p_organization_id
      and (public.is_super_admin() or private.can_access_organization_league(p_organization_id,s.league_id,(select auth.uid())))), '[]'::jsonb);
end $$;

create function public.get_organization_league_levels(p_organization_id uuid)
returns jsonb language sql security invoker set search_path='' as $$
  select private.get_organization_league_levels_impl(p_organization_id)
$$;

create function private.save_organization_league_levels_impl(p_organization_id uuid,p_league_id uuid,p_level_ids uuid[])
returns boolean language plpgsql security definer set search_path='' as $$
begin
  if (select auth.uid()) is null or not private.can_manage_organization_league_settings(p_organization_id,p_league_id) then
    raise exception 'You may update only leagues assigned to you.' using errcode='42501';
  end if;
  if p_level_ids is null or exists (
    select 1 from unnest(p_level_ids) selected(level_id) where selected.level_id is null or not exists (
      select 1 from public.organization_levels ol join public.levels l on l.id=ol.level_id
      where ol.organization_id=p_organization_id and ol.level_id=selected.level_id and ol.active and l.active
    )
  ) then raise exception 'Choose active levels connected to this organization.'; end if;
  insert into private.organization_league_level_settings values (p_organization_id,p_league_id,array(select distinct unnest(p_level_ids)))
  on conflict (organization_id,league_id) do update set level_ids=excluded.level_ids;
  return true;
end $$;

create function public.save_organization_league_levels(p_organization_id uuid,p_league_id uuid,p_level_ids uuid[])
returns boolean language sql security invoker set search_path='' as $$
  select private.save_organization_league_levels_impl(p_organization_id,p_league_id,p_level_ids)
$$;

revoke all on function private.get_organization_league_levels_impl(uuid), private.save_organization_league_levels_impl(uuid,uuid,uuid[]),
 public.get_organization_league_levels(uuid),public.save_organization_league_levels(uuid,uuid,uuid[]) from public,anon;
grant execute on function private.get_organization_league_levels_impl(uuid),private.save_organization_league_levels_impl(uuid,uuid,uuid[]),
 public.get_organization_league_levels(uuid),public.save_organization_league_levels(uuid,uuid,uuid[]) to authenticated,service_role;

-- Imports and other game writers obey the same choices; unchanged games remain editable.
create function private.check_game_league_level() returns trigger
language plpgsql security definer set search_path='' as $$
declare selected_ids uuid[];
begin
  if TG_OP='UPDATE' then
    if new.organization_id is not distinct from old.organization_id and new.league_id is not distinct from old.league_id
      and new.level_id is not distinct from old.level_id then return new; end if;
  end if;
  select level_ids into selected_ids from private.organization_league_level_settings
    where organization_id=new.organization_id and league_id=new.league_id;
  if found and new.level_id is not null and not(new.level_id=any(selected_ids)) then
    raise exception 'This level is not selected for this league. Update Games – Levels or select an enabled level.' using errcode='23514';
  end if;
  return new;
end $$;
revoke all on function private.check_game_league_level() from public,anon,authenticated;
create trigger games_check_league_level before insert or update of organization_id,league_id,level_id on public.games
for each row execute function private.check_game_league_level();
