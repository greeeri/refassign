alter table public.organization_league_coverage
  add column if not exists email_assignor_on_decline boolean not null default false;

alter table public.assignments
  add column if not exists decline_copy_sent_at timestamptz,
  add column if not exists decline_copy_email_error text;

create or replace function public.update_organization_league_decline_email_copy(
  p_organization_id uuid, p_league_id uuid, p_enabled boolean
) returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null or not private.can_manage_organization_league_settings(p_organization_id,p_league_id) then
    raise exception 'You may update only leagues assigned to you.' using errcode = '42501';
  end if;
  update public.organization_league_coverage
  set email_assignor_on_decline=coalesce(p_enabled,false)
  where organization_id=p_organization_id and league_id=p_league_id and active;
  return found;
end;
$$;
revoke all on function public.update_organization_league_decline_email_copy(uuid,uuid,boolean) from public,anon;
grant execute on function public.update_organization_league_decline_email_copy(uuid,uuid,boolean) to authenticated,service_role;

create or replace function private.get_organization_setup_directory_impl(p_organization_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if (select auth.uid()) is null or not private.can_access_organization(p_organization_id) then raise exception 'Not authorized.'; end if;
  return jsonb_build_object(
    'leagues',coalesce((select jsonb_agg(jsonb_build_object(
      'id',league.id,'name',league.name,'mileage_plan',league.mileage_plan,
      'email_assignor_on_decline',link.email_assignor_on_decline
    ) order by league.name)
      from public.organization_league_coverage link join public.leagues league on league.id=link.league_id
      where link.organization_id=p_organization_id and link.active and league.active
        and private.can_manage_organization_league_settings(p_organization_id,league.id)),'[]'::jsonb),
    'levels',coalesce((select jsonb_agg(jsonb_build_object('id',level.id,'name',level.name,'officials_needed',level.officials_needed) order by level.name)
      from public.organization_levels link join public.levels level on level.id=link.level_id
      where link.organization_id=p_organization_id and link.active and level.active),'[]'::jsonb),
    'teams',coalesce((select jsonb_agg(jsonb_build_object('id',team.id,'name',team.name,'sport_id',team.sport_id,'level_id',team.level_id,'level',team.level) order by team.name)
      from public.organization_teams link join public.teams team on team.id=link.team_id
      where link.organization_id=p_organization_id and link.active and team.active),'[]'::jsonb)
  );
end $$;
