begin;
-- Preserve only existing league grants. New grants default deny until an owner
-- explicitly chooses All locations or named locations. No leagues are added.
alter table public.organization_member_league_access
 add column all_locations boolean not null default true,
 add column location_ids uuid[] not null default '{}'::uuid[];
alter table public.organization_member_league_access alter column all_locations set default false;
alter table public.organization_invitations add column league_access jsonb not null default '[]'::jsonb;
-- Pending invitations retain their already-selected league footprint, not the
-- historical admin-wide bypass. Newly created invitations must be explicit.
update public.organization_invitations i set league_access=coalesce((select jsonb_agg(jsonb_build_object('league_id',l,'all_locations',true,'location_ids','[]'::jsonb)) from unnest(i.league_ids) l),'[]'::jsonb);


-- League administrators operate only inside explicit active league grants.
-- No membership, role, scope, invitation or production record is backfilled.
-- Organization ownership/protected super-admin is the only global capability.

create or replace function private.is_organization_owner_or_admin(p_organization_id uuid,p_user_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select p_user_id is not null and (
    (p_user_id=(select auth.uid()) and public.is_super_admin())
    or exists(select 1 from public.organization_memberships m
      where m.organization_id=p_organization_id and m.user_id=p_user_id and m.role='owner')
  );
$$;
comment on function private.is_organization_owner_or_admin(uuid,uuid) is
  'Compatibility name: organization owner or protected super-admin ONLY. Admin is league scoped.';

create or replace function private.can_manage_organization(p_organization_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select (select auth.uid()) is not null and (public.is_super_admin() or (
    private.organization_has_operational_access(p_organization_id)
    and private.is_organization_owner_or_admin(p_organization_id,(select auth.uid()))));
$$;

create or replace function private.can_access_organization_league(p_organization_id uuid,p_league_id uuid,p_user_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select p_user_id is not null and p_league_id is not null
    and exists(select 1 from public.organization_league_coverage c
      where c.organization_id=p_organization_id and c.league_id=p_league_id and c.active)
    and ((p_user_id=(select auth.uid()) and public.is_super_admin()) or (
      private.organization_has_operational_access(p_organization_id)
      and (private.is_organization_owner_or_admin(p_organization_id,p_user_id)
        or exists(select 1 from public.organization_memberships m
          join public.organization_member_league_access a using(organization_id,user_id)
          where m.organization_id=p_organization_id and m.user_id=p_user_id
            and a.league_id=p_league_id and m.role in ('admin','assignor','viewer','billing','mentor','iowa_development_admin')))));
$$;

create or replace function private.can_manage_organization_league(p_organization_id uuid,p_league_id uuid,p_user_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select private.can_access_organization_league(p_organization_id,p_league_id,p_user_id)
    and (private.is_organization_owner_or_admin(p_organization_id,p_user_id)
      or exists(select 1 from public.organization_memberships m
        join public.organization_member_league_access a using(organization_id,user_id)
        where m.organization_id=p_organization_id and m.user_id=p_user_id
          and a.league_id=p_league_id and m.role in ('admin','assignor')));
$$;

create or replace function private.can_manage_organization_league_settings(p_organization_id uuid,p_league_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select private.can_manage_organization_league(p_organization_id,p_league_id,(select auth.uid()));
$$;

create or replace function private.organization_accessible_league_ids(p_organization_id uuid)
returns uuid[] language sql stable security definer set search_path='' as $$
  select coalesce(array_agg(c.league_id order by c.league_id),'{}'::uuid[])
  from public.organization_league_coverage c where c.organization_id=p_organization_id and c.active
    and private.can_access_organization_league(c.organization_id,c.league_id,(select auth.uid()));
$$;

create or replace function private.can_access_organization_league_location(p_organization_id uuid,p_league_id uuid,p_location_id uuid,p_user_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select private.can_access_organization_league(p_organization_id,p_league_id,p_user_id)
 and (private.is_organization_owner_or_admin(p_organization_id,p_user_id)
  or exists(select 1 from public.organization_member_league_access a
    where a.organization_id=p_organization_id and a.league_id=p_league_id and a.user_id=p_user_id
      and (a.all_locations or (p_location_id is not null and p_location_id=any(a.location_ids) and exists(select 1 from public.organization_locations ol join public.locations l on l.id=ol.location_id where ol.organization_id=p_organization_id and ol.location_id=p_location_id and ol.active and l.active)))));
$$;
create or replace function private.can_manage_organization_league_location(p_organization_id uuid,p_league_id uuid,p_location_id uuid,p_user_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select private.can_manage_organization_league(p_organization_id,p_league_id,p_user_id)
 and private.can_access_organization_league_location(p_organization_id,p_league_id,p_location_id,p_user_id);
$$;
create or replace function private.can_manage_organization_league_settings(p_organization_id uuid,p_league_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select private.can_manage_organization_league(p_organization_id,p_league_id,(select auth.uid()))
 and (private.can_manage_organization(p_organization_id) or exists(select 1 from public.organization_member_league_access a
  where a.organization_id=p_organization_id and a.league_id=p_league_id and a.user_id=(select auth.uid()) and a.all_locations));
$$;
create or replace function private.can_manage_game(p_game_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.games g where g.id=p_game_id
   and private.can_manage_organization_league_location(g.organization_id,g.league_id,g.location_id,(select auth.uid())));
$$;
create or replace function private.can_read_organization_game(p_game_id uuid,p_user_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.games g where g.id=p_game_id and (
   private.can_access_organization_league_location(g.organization_id,g.league_id,g.location_id,p_user_id)
   or exists(select 1 from public.assignments a join public.officials o on o.id=a.official_id
     where a.game_id=g.id and o.auth_user_id=p_user_id)));
$$;
revoke all on function private.can_access_organization_league_location(uuid,uuid,uuid,uuid),
 private.can_manage_organization_league_location(uuid,uuid,uuid,uuid) from public,anon;
grant execute on function private.can_access_organization_league_location(uuid,uuid,uuid,uuid),
 private.can_manage_organization_league_location(uuid,uuid,uuid,uuid),private.can_manage_game(uuid) to authenticated,service_role;

-- Old/new row predicates both apply, so a game cannot be moved out of or into a
-- manager's grant through UPDATE, even if they are its personally assigned official.
create policy "Location scope read fence" on public.games as restrictive for select to authenticated
 using(private.can_read_organization_game(id,(select auth.uid())));
create policy "Location scope insert fence" on public.games as restrictive for insert to authenticated
 with check(private.can_manage_organization_league_location(organization_id,league_id,location_id,(select auth.uid())));
create policy "Location scope update fence" on public.games as restrictive for update to authenticated
 using(private.can_manage_organization_league_location(organization_id,league_id,location_id,(select auth.uid())))
 with check(private.can_manage_organization_league_location(organization_id,league_id,location_id,(select auth.uid())));
create policy "Location scope delete fence" on public.games as restrictive for delete to authenticated
 using(private.can_manage_organization_league_location(organization_id,league_id,location_id,(select auth.uid())));
create policy "Location scope read fence" on public.assignments as restrictive for select to authenticated
 using(private.can_read_organization_game(game_id,(select auth.uid())));
create policy "Location scope insert fence" on public.assignments as restrictive for insert to authenticated
 with check(private.can_manage_game(game_id));
create policy "Location scope update fence" on public.assignments as restrictive for update to authenticated
 using(private.can_manage_game(game_id))
 with check(private.can_manage_game(game_id));
create policy "Location scope delete fence" on public.assignments as restrictive for delete to authenticated
 using(private.can_manage_game(game_id));

-- Resource visibility is derived from explicit league configuration or existing
-- in-scope games. An absent team/level configuration is NOT an all-org fallback.
create or replace function private.can_read_organization_team(p_organization_id uuid,p_team_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select (select auth.uid()) is not null and (
  private.can_manage_organization(p_organization_id)
  or exists(select 1 from private.organization_league_team_settings s
    where s.organization_id=p_organization_id and p_team_id=any(s.team_ids)
      and private.can_access_organization_league(s.organization_id,s.league_id,(select auth.uid())))
  or exists(select 1 from public.games g where g.organization_id=p_organization_id
    and p_team_id in (g.home_team_id,g.away_team_id)
    and private.can_access_organization_league_location(g.organization_id,g.league_id,g.location_id,(select auth.uid())))
 );
$$;
create or replace function private.can_read_organization_level(p_organization_id uuid,p_level_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select (select auth.uid()) is not null and (
  private.can_manage_organization(p_organization_id)
  or exists(select 1 from private.organization_league_level_settings s
    where s.organization_id=p_organization_id and p_level_id=any(s.level_ids)
      and private.can_access_organization_league(s.organization_id,s.league_id,(select auth.uid())))
  or exists(select 1 from public.games g where g.organization_id=p_organization_id and g.level_id=p_level_id
    and private.can_access_organization_league_location(g.organization_id,g.league_id,g.location_id,(select auth.uid())))
 );
$$;
create or replace function private.can_read_organization_location(p_organization_id uuid,p_location_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select (select auth.uid()) is not null and (
  private.can_manage_organization(p_organization_id)
  or exists(select 1 from public.games g where g.organization_id=p_organization_id
    and private.can_access_organization_league_location(g.organization_id,g.league_id,g.location_id,(select auth.uid()))
    and (g.location_id=p_location_id or exists(
      select 1 from public.organization_locations source join public.organization_locations sibling
        on sibling.organization_id=source.organization_id
          and nullif(lower(trim(sibling.field_complex)),'')=nullif(lower(trim(source.field_complex)),'')
      where source.organization_id=p_organization_id and source.location_id=g.location_id
        and sibling.location_id=p_location_id and source.active and sibling.active)))
 );
$$;
create or replace function private.can_read_organization_official(p_organization_id uuid,p_official_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select (select auth.uid()) is not null and (
  private.can_manage_organization(p_organization_id)
  or exists(select 1 from public.officials o where o.id=p_official_id and o.auth_user_id=(select auth.uid()))
  or exists(select 1 from public.official_league_eligibility e where e.official_id=p_official_id
    and private.can_access_organization_league(p_organization_id,e.league_id,(select auth.uid())))
  or exists(select 1 from public.assignments a join public.games g on g.id=a.game_id
    where a.official_id=p_official_id and g.organization_id=p_organization_id
      and private.can_access_organization_league_location(g.organization_id,g.league_id,g.location_id,(select auth.uid())))
 );
$$;
create or replace function private.can_read_scoped_resource(p_kind text,p_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select (select auth.uid()) is not null and (public.is_super_admin()
  or (p_kind='official' and (exists(select 1 from public.officials o where o.id=p_id and o.auth_user_id=(select auth.uid()))
    or exists(select 1 from public.organization_officials x where x.official_id=p_id and x.active
      and private.can_read_organization_official(x.organization_id,p_id))))
  or (p_kind='league' and (exists(select 1 from public.organization_league_coverage c where c.league_id=p_id
    and private.can_access_organization_league(c.organization_id,p_id,(select auth.uid())))
    or exists(select 1 from public.league_staff_access s where s.league_id=p_id and s.user_id=(select auth.uid()))
    or exists(select 1 from public.official_league_eligibility e join public.officials o on o.id=e.official_id where e.league_id=p_id and o.active and o.auth_user_id=(select auth.uid()))))
  or (p_kind='team' and exists(select 1 from public.organization_teams x where x.team_id=p_id and x.active and private.can_read_organization_team(x.organization_id,p_id)))
  or (p_kind='level' and exists(select 1 from public.organization_levels x where x.level_id=p_id and x.active and private.can_read_organization_level(x.organization_id,p_id)))
  or (p_kind='location' and exists(select 1 from public.organization_locations x where x.location_id=p_id and x.active and private.can_read_organization_location(x.organization_id,p_id)))
  -- Personal official/crew access remains independent of administrative scope.
  or exists(select 1 from public.games g where
    ((p_kind='league' and g.league_id=p_id) or (p_kind='team' and p_id in(g.home_team_id,g.away_team_id))
     or (p_kind='level' and g.level_id=p_id) or (p_kind='location' and g.location_id=p_id))
    and exists(select 1 from public.assignments a join public.officials o on o.id=a.official_id
      where a.game_id=g.id and o.auth_user_id=(select auth.uid())))
 );
$$;
create or replace function private.can_manage_shared_resource(p_kind text,p_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select (select auth.uid()) is not null and (public.is_super_admin()
  or (p_kind='official' and exists(select 1 from public.organization_officials x where x.official_id=p_id and x.active and private.can_manage_organization(x.organization_id)))
  or (p_kind='league' and exists(select 1 from public.organization_league_coverage x where x.league_id=p_id and x.active and private.can_manage_organization(x.organization_id)))
  or (p_kind='team' and exists(select 1 from public.organization_teams x where x.team_id=p_id and x.active and private.can_manage_organization(x.organization_id)))
  or (p_kind='level' and exists(select 1 from public.organization_levels x where x.level_id=p_id and x.active and private.can_manage_organization(x.organization_id)))
  or (p_kind='location' and exists(select 1 from public.organization_locations x where x.location_id=p_id and x.active and private.can_manage_organization(x.organization_id)))
 );
$$;

create or replace function private.can_rank_official(p_official_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select (select auth.uid()) is not null and (public.is_super_admin() or exists(
  select 1 from public.organization_officials x where x.official_id=p_official_id and x.active
    and private.can_read_organization_official(x.organization_id,p_official_id)
    and (private.can_manage_organization(x.organization_id) or exists(select 1 from public.organization_league_coverage c
      where c.organization_id=x.organization_id and private.can_manage_organization_league(c.organization_id,c.league_id,(select auth.uid()))))));
$$;
create or replace function private.can_rank_team(p_team_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select (select auth.uid()) is not null and (public.is_super_admin() or exists(
  select 1 from public.organization_teams x where x.team_id=p_team_id and x.active
    and private.can_read_organization_team(x.organization_id,p_team_id)
    and (private.can_manage_organization(x.organization_id) or exists(select 1 from public.organization_league_coverage c
      where c.organization_id=x.organization_id and private.can_manage_organization_league(c.organization_id,c.league_id,(select auth.uid()))))));
$$;

-- Predicate grants are explicit. Do not expose arbitrary definer APIs to anon.
revoke all on function private.organization_accessible_league_ids(uuid),
 private.can_read_organization_team(uuid,uuid),private.can_read_organization_level(uuid,uuid),
 private.can_read_organization_location(uuid,uuid),private.can_read_organization_official(uuid,uuid),
 private.can_read_scoped_resource(text,uuid),private.can_manage_shared_resource(text,uuid)
 from public,anon;
grant execute on function private.organization_accessible_league_ids(uuid),
 private.can_read_organization_team(uuid,uuid),private.can_read_organization_level(uuid,uuid),
 private.can_read_organization_location(uuid,uuid),private.can_read_organization_official(uuid,uuid),
 private.can_read_scoped_resource(text,uuid),private.can_manage_shared_resource(text,uuid)
 to authenticated,service_role;

-- Restrictive fences are ANDed with every historical permissive policy. Old
-- profiles.role/user_roles/contact grants therefore cannot bypass league scope.
do $policies$
declare row record; command text; predicate text;
begin
 for row in select * from (values
  ('leagues','league'),('teams','team'),('levels','level'),('locations','location'),('officials','official')
 ) as r(table_name,kind) loop
  execute format('create policy "Scoped resource reads" on public.%I for select to authenticated using (private.can_read_scoped_resource(%L,id))',row.table_name,row.kind);
  execute format('create policy "League scope read fence" on public.%I as restrictive for select to authenticated using (private.can_read_scoped_resource(%L,id))',row.table_name,row.kind);
  foreach command in array array['insert','update','delete'] loop
   predicate:=format('private.can_manage_shared_resource(%L,id)',row.kind);
   if row.kind='official' and command='update' then
    predicate:='('||predicate||' or auth_user_id=(select auth.uid()))';
   end if;
   execute format('create policy %I on public.%I as restrictive for %s to authenticated %s %s',
    'League scope '||command||' fence',row.table_name,command,
    case when command<>'insert' then 'using ('||predicate||')' else '' end,
    case when command<>'delete' then 'with check ('||predicate||')' else '' end);
   if command<>'insert' then
    execute format('create policy %I on public.%I for %s to authenticated using (%s) %s',
     'Owners manage shared '||command,row.table_name,command,predicate,
     case when command='update' then 'with check ('||predicate||')' else '' end);
   end if;
  end loop;
 end loop;
 for row in select * from (values
  ('organization_memberships','user_id=(select auth.uid()) or private.can_manage_organization(organization_id)','private.can_manage_organization(organization_id)'),
  ('organization_member_league_access','user_id=(select auth.uid()) or private.can_manage_organization(organization_id)','private.can_manage_organization(organization_id)'),
  ('organization_user_access_profiles','user_id=(select auth.uid()) or private.can_manage_organization(organization_id)','private.can_manage_organization(organization_id)'),
  ('organization_league_coverage','private.can_access_organization_league(organization_id,league_id,(select auth.uid()))','private.can_manage_organization(organization_id)'),
  ('organization_officials','private.can_read_organization_official(organization_id,official_id)','private.can_manage_organization(organization_id)'),
  ('organization_teams','private.can_read_organization_team(organization_id,team_id)','private.can_manage_organization(organization_id)'),
  ('organization_levels','private.can_read_organization_level(organization_id,level_id)','private.can_manage_organization(organization_id)'),
  ('organization_locations','private.can_read_organization_location(organization_id,location_id)','private.can_manage_organization(organization_id)'),
  ('official_league_eligibility','private.can_read_scoped_resource(''official'',official_id) and private.can_read_scoped_resource(''league'',league_id)',
   'exists(select 1 from public.organization_officials oo where oo.official_id=official_league_eligibility.official_id and oo.active and private.can_manage_organization_league_settings(oo.organization_id,official_league_eligibility.league_id))'),
  ('official_level_eligibility','private.can_read_scoped_resource(''official'',official_id) and private.can_read_scoped_resource(''level'',level_id)','private.can_manage_shared_resource(''official'',official_id)'),
  ('team_power_rankings','private.can_read_scoped_resource(''team'',team_id)','private.can_manage_shared_resource(''team'',team_id)'),
  ('official_availability_blocks','private.can_read_scoped_resource(''official'',official_id)','private.can_manage_shared_resource(''official'',official_id) or exists(select 1 from public.officials o where o.id=official_availability_blocks.official_id and o.auth_user_id=(select auth.uid()))'),
  ('block_removal_requests','private.can_read_scoped_resource(''official'',official_id)','private.can_manage_shared_resource(''official'',official_id) or exists(select 1 from public.officials o where o.id=block_removal_requests.official_id and o.auth_user_id=(select auth.uid()))'),
  ('auto_assign_rules','private.can_access_organization(organization_id) and (private.can_manage_organization(organization_id) or cardinality(private.organization_accessible_league_ids(organization_id))>0)','private.can_manage_organization(organization_id)'),
  ('import_error_log','private.can_manage_organization(organization_id)','private.can_manage_organization(organization_id)'),
  ('audit_history','private.can_manage_organization(organization_id) or (game_id is not null and private.can_read_organization_game(game_id,(select auth.uid())))','private.can_manage_organization(organization_id)')
 ) as r(table_name,read_predicate,write_predicate) loop
  execute format('create policy "League scope read fence" on public.%I as restrictive for select to authenticated using (%s)',row.table_name,row.read_predicate);
  foreach command in array array['insert','update','delete'] loop
   execute format('create policy %I on public.%I as restrictive for %s to authenticated %s %s',
    'League scope '||command||' fence',row.table_name,command,
    case when command<>'insert' then 'using ('||row.write_predicate||')' else '' end,
    case when command<>'delete' then 'with check ('||row.write_predicate||')' else '' end);
  end loop;
 end loop;
end $policies$;

-- Old SECURITY DEFINER AutoAssign has no organization/league argument. Keep it
-- unavailable to browser callers; the scoped invoker run_my_auto_assign remains.
revoke all on function public.run_auto_assign(date,date) from public,anon,authenticated;
revoke all on function public.run_auto_assign_core(date,date) from public,anon,authenticated;

create or replace function private.get_game_directory_impl(p_organization_id uuid,p_league_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare scopes uuid[]; full_access boolean;
begin
 if (select auth.uid()) is null or not private.can_access_organization(p_organization_id) then
  raise exception 'Not authorized.' using errcode='42501';
 end if;
 scopes:=private.organization_accessible_league_ids(p_organization_id);
 full_access:=private.can_manage_organization(p_organization_id);
 if p_league_id is not null and not p_league_id=any(scopes) then
  raise exception 'League is not available.' using errcode='42501';
 end if;
 if p_league_id is not null then scopes:=array[p_league_id]; end if;
 return jsonb_build_object(
  'teams',coalesce((select jsonb_agg(jsonb_build_object('id',t.id,'name',t.name,'sport_id',t.sport_id,'level_id',t.level_id) order by t.name,t.id)
   from public.organization_teams ot join public.teams t on t.id=ot.team_id
   where ot.organization_id=p_organization_id and (
    (ot.active and t.active and ((full_access and (p_league_id is null or not exists(select 1 from private.organization_league_team_settings s where s.organization_id=p_organization_id and s.league_id=p_league_id)))
      or exists(select 1 from private.organization_league_team_settings s where s.organization_id=p_organization_id and s.league_id=any(scopes) and t.id=any(s.team_ids))))
    or exists(select 1 from public.games g where g.organization_id=p_organization_id and g.league_id=any(scopes) and private.can_access_organization_league_location(g.organization_id,g.league_id,g.location_id,(select auth.uid())) and t.id in(g.home_team_id,g.away_team_id)))),'[]'::jsonb),
  'levels',coalesce((select jsonb_agg(jsonb_build_object('id',l.id,'name',l.name) order by l.name,l.id)
   from public.organization_levels ol join public.levels l on l.id=ol.level_id
   where ol.organization_id=p_organization_id and (
    (ol.active and l.active and ((full_access and (p_league_id is null or not exists(select 1 from private.organization_league_level_settings s where s.organization_id=p_organization_id and s.league_id=p_league_id)))
      or exists(select 1 from private.organization_league_level_settings s where s.organization_id=p_organization_id and s.league_id=any(scopes) and l.id=any(s.level_ids))))
    or exists(select 1 from public.games g where g.organization_id=p_organization_id and g.league_id=any(scopes) and private.can_access_organization_league_location(g.organization_id,g.league_id,g.location_id,(select auth.uid())) and g.level_id=l.id))),'[]'::jsonb),
  'team_settings',coalesce((select jsonb_agg(jsonb_build_object('league_id',s.league_id,'team_ids',s.team_ids)) from private.organization_league_team_settings s where s.organization_id=p_organization_id and s.league_id=any(scopes)),'[]'::jsonb),
  'level_settings',coalesce((select jsonb_agg(jsonb_build_object('league_id',s.league_id,'level_ids',s.level_ids)) from private.organization_league_level_settings s where s.organization_id=p_organization_id and s.league_id=any(scopes)),'[]'::jsonb)
 );
end $$;

create or replace function public.get_organization_field_complexes(p_organization_id uuid)
returns table(location_id uuid,field_complex text)
language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or not private.can_access_organization(p_organization_id) then
  raise exception 'No access to field complexes.' using errcode='42501';
 end if;
 return query select x.location_id,x.field_complex from public.organization_locations x
 where x.organization_id=p_organization_id and x.active
   and private.can_read_organization_location(x.organization_id,x.location_id);
end $$;
create or replace function public.set_organization_field_complex(p_organization_id uuid,p_location_id uuid,p_field_complex text)
returns text language plpgsql security definer set search_path='' as $$
declare v_complex text:=nullif(trim(p_field_complex),'');
begin
 if not private.can_manage_organization(p_organization_id) then
  raise exception 'Only an organization owner can change shared field complexes.' using errcode='42501';
 end if;
 if length(v_complex)>80 then raise exception 'Field complex must be 80 characters or fewer.'; end if;
 update public.organization_locations set field_complex=v_complex where organization_id=p_organization_id and location_id=p_location_id and active;
 if not found then raise exception 'This location is not connected to the organization.'; end if;
 return v_complex;
end $$;


create or replace function private.get_my_test_workspaces_impl()
returns jsonb
language sql
stable
security definer
set search_path=''
as $$
  with access as (
    select
      organization.id as organization_id,
      coalesce((select array_agg(distinct m.role order by m.role)
        from public.organization_memberships m
        where m.organization_id=organization.id and m.user_id=(select auth.uid())), '{}'::text[])
        || case when public.is_super_admin() then array['admin']::text[] else '{}'::text[] end
        || case when access_profile.roles @> array['official']::text[] then array['official']::text[] else '{}'::text[] end as roles,
      coalesce(access_profile.viewer_permissions,'{}'::text[]) as viewer_permissions
    from public.organizations organization
    left join public.organization_user_access_profiles access_profile
      on access_profile.organization_id = organization.id
     and access_profile.user_id = (select auth.uid())
    where public.is_super_admin()
       or access_profile.user_id is not null
       or exists (
         select 1
         from public.organization_memberships membership
         where membership.organization_id = organization.id
           and membership.user_id = (select auth.uid())
       )
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'organization_id',organization.id,
        'name',organization.name,
        'primary_sport',organization.primary_sport,
        'created_at',organization.created_at,
        'role',coalesce((access.roles)[1],'official'),
        'roles',access.roles,
        'full_organization_access',private.can_manage_organization(organization.id),
        'viewer_permissions',access.viewer_permissions,
        'plan',subscription.plan,
        'official_limit',subscription.official_limit,
        'additional_official_blocks',subscription.additional_official_blocks,
        'status',subscription.status,
        'texting_addon',coalesce((
          select addon.enabled
          from public.organization_addons addon
          where addon.organization_id = organization.id
            and addon.code = 'text_messaging'
        ),false),
        'leagues',coalesce((
          select jsonb_agg(jsonb_build_object('league_id',league.id,'name',league.name,'all_locations',private.can_manage_organization(organization.id) or coalesce((select a.all_locations from public.organization_member_league_access a where a.organization_id=organization.id and a.league_id=league.id and a.user_id=(select auth.uid())),false),'location_ids',coalesce((select a.location_ids from public.organization_member_league_access a where a.organization_id=organization.id and a.league_id=league.id and a.user_id=(select auth.uid())),'{}'::uuid[])))
          from public.organization_league_coverage coverage
          join public.leagues league on league.id = coverage.league_id
          where coverage.organization_id = organization.id
            and coverage.active
            and private.can_access_organization_league(organization.id,league.id,(select auth.uid()))
        ),'[]'::jsonb)
      ) order by organization.created_at desc
    ),
    '[]'::jsonb
  )
  from access
  join public.organizations organization on organization.id = access.organization_id
  left join lateral (
    select *
    from public.refassign_subscriptions latest_subscription
    where latest_subscription.organization_id = organization.id
    order by latest_subscription.created_at desc
    limit 1
  ) subscription on true;
$$;

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
      where link.organization_id=p_organization_id and link.active and level.active and private.can_read_organization_level(p_organization_id,level.id)),'[]'::jsonb),
    'teams',coalesce((select jsonb_agg(jsonb_build_object('id',team.id,'name',team.name,'sport_id',team.sport_id,'level_id',team.level_id,'level',team.level) order by team.name)
      from public.organization_teams link join public.teams team on team.id=link.team_id
      where link.organization_id=p_organization_id and link.active and team.active and private.can_read_organization_team(p_organization_id,team.id)),'[]'::jsonb)
  );
end $$;

create or replace function private.get_organization_locations_impl(p_organization_id uuid)
returns table(
  id uuid,name text,address text,city text,state text,directions text,
  parking_instructions text,entrance_information text,map_url text,
  contact_name text,contact_phone text,contact_email text
)
language plpgsql security definer set search_path='' as $$
begin
  if (select auth.uid()) is null or not private.can_access_organization(p_organization_id) then
    raise exception 'Not authorized.';
  end if;
  return query
  select l.id,coalesce(nullif(ol.display_name,''),l.name),l.address,l.city,l.state,
    l.directions,l.parking_instructions,l.entrance_information,l.map_url,
    l.contact_name,l.contact_phone,l.contact_email
  from public.organization_locations ol
  join public.locations l on l.id=ol.location_id
  where ol.organization_id=p_organization_id and ol.active and l.active and private.can_read_organization_location(p_organization_id,l.id)
  order by coalesce(nullif(ol.display_name,''),l.name);
end $$;

create or replace function private.get_organization_official_directory_impl(p_organization_id uuid)
returns table(
  id uuid, first_name text, last_name text, date_of_birth date, is_minor boolean,
  gender text, ethnicity text, email text, secondary_email text, home_address text,
  address_unit text, home_city text, home_state text, home_zip text, country text,
  phone text, mobile_phone text, license text, license_status text,
  license_issue_date date, license_expiration_date date, license_issuer text,
  curriculum text, background_screening text,
  background_screening_expiration_date date, safesport text,
  safesport_expiration_date date, intro_player_safety text,
  intro_player_safety_expiration_date date, safe_soccer text,
  safe_soccer_expiration_date date, provisional_status text,
  referee_years_experience integer, sports text[], home_area text,
  certification_level text, college_license_level text,
  high_school_license_level text, us_soccer_license_level text,
  organization_active boolean, max_games_per_day integer,
  eligible_leagues text, eligible_levels text, general_rank numeric,
  ref_rank numeric, ar1_rank numeric, ar2_rank numeric, fourth_rank numeric,
  mentor_certified boolean, notes text
)
language plpgsql security definer set search_path='' as $$
begin
  if (select auth.uid()) is null or not (private.can_manage_organization(p_organization_id) or exists(select 1 from public.organization_league_coverage c where c.organization_id=p_organization_id and private.can_manage_organization_league(c.organization_id,c.league_id,(select auth.uid())))) then
    raise exception 'Not authorized.';
  end if;
  return query
  select o.id,o.first_name,o.last_name,o.date_of_birth,o.is_minor,o.gender,
    o.ethnicity,o.email,o.secondary_email,o.home_address,o.address_unit,
    o.home_city,o.home_state,o.home_zip,o.country,o.phone,o.mobile_phone,
    o.license,o.license_status,o.license_issue_date,o.license_expiration_date,
    o.license_issuer,o.curriculum,o.background_screening,
    o.background_screening_expiration_date,o.safesport,o.safesport_expiration_date,
    o.intro_player_safety,o.intro_player_safety_expiration_date,o.safe_soccer,
    o.safe_soccer_expiration_date,o.provisional_status,o.referee_years_experience,
    o.sports,o.home_area,o.certification_level,o.college_license_level,
    o.high_school_license_level,o.us_soccer_license_level,oo.active,
    o.max_games_per_day,
    coalesce((select string_agg(l.name,', ' order by l.name)
      from public.official_league_eligibility e join public.leagues l on l.id=e.league_id
      where e.official_id=o.id and exists(select 1 from public.organization_league_coverage c
        where c.organization_id=p_organization_id and c.league_id=e.league_id and c.active and private.can_access_organization_league(c.organization_id,c.league_id,(select auth.uid())))),''),
    coalesce((select string_agg(lv.name,', ' order by lv.name)
      from public.official_level_eligibility e join public.levels lv on lv.id=e.level_id
      where e.official_id=o.id and exists(select 1 from public.organization_levels ol
        where ol.organization_id=p_organization_id and ol.level_id=e.level_id and ol.active and private.can_read_organization_level(p_organization_id,e.level_id))),''),
    coalesce(r.rank,1),coalesce(r.ref_rank,1),coalesce(r.ar1_rank,1),
    coalesce(r.ar2_rank,1),coalesce(r.fourth_rank,1),coalesce(mc.certified,false),o.notes
  from public.organization_officials oo
  join public.officials o on o.id=oo.official_id
  left join public.assignor_official_rankings r
    on r.official_id=o.id and r.assignor_id=auth.uid()
  left join public.official_mentor_certifications mc on mc.official_id=o.id
  where oo.organization_id=p_organization_id and private.can_read_organization_official(p_organization_id,o.id)
  order by o.last_name nulls last,o.first_name nulls last,o.email;
end $$;

create or replace function public.move_official_between_fields(
  p_source_assignment_id uuid, p_target_game_id uuid, p_target_position_id uuid,
  p_mode text, p_accept boolean default false, p_override boolean default false,
  p_preview boolean default false
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
  v_source_checkin public.assignment_check_ins%rowtype;
  v_target_checkin public.assignment_check_ins%rowtype;
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
  if not private.can_manage_organization_league_location(v_source_game.organization_id,v_source_game.league_id,v_source_game.location_id,auth.uid())
    or not private.can_manage_organization_league_location(v_target_game.organization_id,v_target_game.league_id,v_target_game.location_id,auth.uid()) then
    raise exception 'No league access to both games.' using errcode='42501';
  end if;
  if exists (select 1 from public.game_link_members where game_id in (v_source_game.id,v_target_game.id)) then
    raise exception 'Unlink these games before moving one official.';
  end if;
  select * into v_source_location from public.locations where id = v_source_game.location_id;
  select * into v_target_location from public.locations where id = v_target_game.location_id;
  select nullif(lower(trim(ol.field_complex)),'') into v_source_complex
  from public.organization_locations ol where ol.organization_id = v_source_game.organization_id
    and ol.location_id = v_source_game.location_id and ol.active;
  select nullif(lower(trim(ol.field_complex)),'') into v_target_complex
  from public.organization_locations ol where ol.organization_id = v_target_game.organization_id
    and ol.location_id = v_target_game.location_id and ol.active;
  v_source_complex := coalesce(v_source_complex,nullif(lower(trim(v_source_location.field_complex)),''));
  v_target_complex := coalesce(v_target_complex,nullif(lower(trim(v_target_location.field_complex)),''));
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
    and lower(status) not in ('declined','cancelled','canceled') order by assigned_at desc limit 1 for update;
  if p_mode = 'transfer' and v_target.id is not null then raise exception 'Transfer requires an open position. Choose Switch for an occupied position.'; end if;
  if v_target.id is not null and v_target.official_id = v_source.official_id then raise exception 'This official is already in the destination position.'; end if;
  if v_source.payment_status in ('approved','paid') or (v_target.id is not null and v_target.payment_status in ('approved','paid'))
    or exists (select 1 from public.payroll_batch_items i where i.assignment_id in (v_source.id,v_target.id))
    or exists (select 1 from public.payroll_fee_corrections c where c.assignment_id in (v_source.id,v_target.id)) then
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
  -- Other bookings cannot be overridden, including bookings in another organization.
  for v_other in select a.official_id,g.game_number from public.assignments a join public.games g on g.id = a.game_id
    where a.official_id in (v_source.official_id,v_target.official_id) and a.id not in (v_source.id,coalesce(v_target.id,v_source.id))
      and a.status not in ('declined','cancelled','canceled') and lower(g.status) not in ('cancelled','canceled','rained_out','rain_out')
      and g.starts_at < v_target_game.starts_at + make_interval(mins => greatest(coalesce(v_source_game.duration_minutes,110),coalesce(v_target_game.duration_minutes,110)))
      and g.starts_at + make_interval(mins => coalesce(g.duration_minutes,110)) > v_target_game.starts_at
    limit 1
  loop raise exception 'Official has an overlapping assignment on Game #%.',v_other.game_number; end loop;
  if cardinality(v_reasons) > 0 and not p_override then raise exception 'Eligibility override required: %',array_to_string(v_reasons,'; '); end if;
  if p_preview then
    return jsonb_build_object('preview',true,'targetGameId',v_target_game.id,
      'sourceGameId',v_source_game.id,'occupied',v_target.id is not null);
  end if;
  select * into v_source_checkin from public.assignment_check_ins where assignment_id = v_source.id;
  if v_target.id is not null then
    select * into v_target_checkin from public.assignment_check_ins where assignment_id = v_target.id;
  end if;
  delete from public.assignments where id in (v_source.id,v_target.id);
  -- Historic declined offers retain their audit records, but their unique
  -- game/position and game/official keys must be cleared for the new offer.
  delete from public.assignments where game_id = v_target_game.id and lower(status) in ('declined','cancelled','canceled')
    and (position_id = p_target_position_id or official_id = v_source.official_id);
  if v_target.id is not null then
    delete from public.assignments where game_id = v_source_game.id and lower(status) in ('declined','cancelled','canceled')
      and (position_id = v_source.position_id or official_id = v_target.official_id);
  end if;
  insert into public.assignments(game_id,position_id,official_id,status,published_at,responded_at,response_token,assignment_source)
  values (v_target_game.id,p_target_position_id,v_source.official_id,case when p_accept then 'accepted' else 'proposed' end,
    case when p_accept then now() else null end,case when p_accept then now() else null end,v_source.response_token,'manager') returning id into v_created_target;
  if v_target.id is not null then
    insert into public.assignments(game_id,position_id,official_id,status,published_at,responded_at,response_token,assignment_source)
    values (v_source_game.id,v_source.position_id,v_target.official_id,case when p_accept then 'accepted' else 'proposed' end,
      case when p_accept then now() else null end,case when p_accept then now() else null end,v_target.response_token,'manager') returning id into v_created_source;
  end if;
  if v_source_checkin.assignment_id is not null then
    insert into public.assignment_check_ins(assignment_id,checked_in_at,checked_in_by)
    values (v_created_target,v_source_checkin.checked_in_at,v_source_checkin.checked_in_by);
  end if;
  if v_created_source is not null and v_target_checkin.assignment_id is not null then
    insert into public.assignment_check_ins(assignment_id,checked_in_at,checked_in_by)
    values (v_created_source,v_target_checkin.checked_in_at,v_target_checkin.checked_in_by);
  end if;
  insert into public.audit_history(entity_type,entity_id,game_id,assignment_id,action,actor_user_id,actor_name,summary)
  values ('assignment',v_created_target,v_target_game.id,v_created_target,p_mode,auth.uid(),public.audit_actor_name(auth.uid()),
    format('%s from Game #%s to Game #%s%s',initcap(p_mode),v_source_game.game_number,v_target_game.game_number,case when p_override then ' with eligibility override' else '' end));
  return jsonb_build_object('targetAssignmentId',v_created_target,'sourceAssignmentId',v_created_source,
    'targetGameId',v_target_game.id,'sourceGameId',v_source_game.id);
end;
$$;

create or replace function public.self_assign_game_mentor(p_game_id uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_game public.games%rowtype;v_official_id uuid;v_position_id uuid;v_assignment_id uuid;
begin
  select * into v_game from public.games where id=p_game_id for update;
  if v_game.id is null or v_game.starts_at<now() or v_game.status not in ('active','open') then
    raise exception 'This game is no longer available for mentor self-assignment.';
  end if;
  if not private.can_access_organization_league_location(v_game.organization_id,v_game.league_id,v_game.location_id,(select auth.uid())) or not exists(
    select 1 from public.organization_memberships membership
    join public.organization_member_league_access league_access using(organization_id,user_id)
    where membership.organization_id=v_game.organization_id and membership.user_id=(select auth.uid())
      and membership.role='mentor' and league_access.league_id=v_game.league_id
  ) then raise exception 'Mentor access is required.' using errcode='42501'; end if;
  select id into v_official_id from public.officials where auth_user_id=(select auth.uid()) and active limit 1;
  if v_official_id is null or not exists(select 1 from public.official_mentor_certifications where official_id=v_official_id and certified) then
    raise exception 'An active mentor-certified official profile is required.';
  end if;
  select position.id into v_position_id from public.sport_positions position
  where position.sport_id=v_game.sport_id and lower(position.name) like '%mentor%'
  order by position.sort_order,position.id limit 1;
  if v_position_id is null then raise exception 'A Mentor position is not configured for this sport.'; end if;
  insert into public.game_mentor_slots(game_id,position_id,created_by) values(p_game_id,v_position_id,(select auth.uid()))
  on conflict(game_id) do nothing;
  if exists(select 1 from public.assignments where game_id=p_game_id and position_id=v_position_id and status<>'declined') then
    raise exception 'This game already has a mentor assigned.';
  end if;
  insert into public.assignments(game_id,official_id,position_id,status,assignment_source,published_at,responded_at)
  values(p_game_id,v_official_id,v_position_id,'accepted','self_assign',now(),now()) returning id into v_assignment_id;
  return v_assignment_id;
end; $$;

create or replace function public.apply_game_import(p_rows jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_row jsonb;
  v_organization_id uuid;
  v_league_id uuid;
  v_level_id uuid;
  v_home_team_id uuid;
  v_away_team_id uuid;
  v_location_id uuid;
  v_bill_to_id uuid;
  v_added integer := 0;
  v_updated integer := 0;
  v_skipped integer := 0;
begin
  if jsonb_typeof(p_rows) <> 'array' then
    raise exception 'Import payload must be an array';
  end if;

  -- Preflight every update before changing any row.
  for v_row in select value from jsonb_array_elements(p_rows)
  loop
    if v_row->>'action' not in ('update', 'add', 'skip') then
      raise exception 'Spreadsheet row % — Game % — unsupported import action: %',
        coalesce(v_row->>'row', '?'),
        coalesce(nullif(v_row->>'game_number', ''), 'NEW'),
        coalesce(v_row->>'action', 'blank');
    end if;
    if v_row->>'action' = 'skip' then continue; end if;

    v_organization_id := (v_row->>'organization_id')::uuid;
    v_league_id := (v_row->>'league_id')::uuid;
    if auth.uid() is null or not private.can_manage_organization_league_location(v_organization_id,v_league_id,(v_row->>'location_id')::uuid,auth.uid()) then
      raise exception 'Spreadsheet row % — Game % — you cannot import games for this organization',
        coalesce(v_row->>'row', '?'), coalesce(nullif(v_row->>'game_number', ''), 'NEW')
        using errcode = '42501';
    end if;
    if not private.can_manage_organization_league_location(v_organization_id,v_league_id,(v_row->>'location_id')::uuid,auth.uid()) then
      raise exception 'Spreadsheet row % — Game % — the selected league is not available to this organization',
        coalesce(v_row->>'row', '?'), coalesce(nullif(v_row->>'game_number', ''), 'NEW')
        using errcode = '42501';
    end if;
    if v_row->>'action' = 'update' and not exists (
      select 1 from public.games
      where id = (v_row->>'game_id')::uuid and organization_id = v_organization_id
        and private.can_manage_organization_league_location(organization_id,league_id,location_id,auth.uid())
    ) then
      raise exception 'Spreadsheet row % — Game % — the game being updated is not in the selected organization',
        coalesce(v_row->>'row', '?'), coalesce(nullif(v_row->>'game_number', ''), 'NEW');
    end if;
  end loop;

  -- Remove the old schedule positions of every update in one operation. This
  -- prevents spreadsheet row order from affecting otherwise valid changes.
  perform set_config('refassign.game_import_staging', 'on', true);
  update public.games game
  set time_tbd = true
  where game.id in (
    select (row_value->>'game_id')::uuid
    from jsonb_array_elements(p_rows) row_value
    where row_value->>'action' = 'update'
  );
  perform set_config('refassign.game_import_staging', 'off', true);

  for v_row in select value from jsonb_array_elements(p_rows)
  loop
    if v_row->>'action' = 'skip' then
      v_skipped := v_skipped + 1;
      continue;
    end if;
    begin
      v_organization_id := (v_row->>'organization_id')::uuid;
      v_league_id := (v_row->>'league_id')::uuid;
      v_level_id := (v_row->>'level_id')::uuid;
      v_home_team_id := (v_row->>'home_team_id')::uuid;
      v_away_team_id := (v_row->>'away_team_id')::uuid;
      v_location_id := (v_row->>'location_id')::uuid;
      v_bill_to_id := nullif(v_row->>'bill_to_id', '')::uuid;

      if not exists (select 1 from public.organization_levels x where x.organization_id = v_organization_id and x.level_id = v_level_id and x.active) then
        raise exception 'The selected level is not active for this organization';
      end if;
      if not exists (select 1 from public.organization_teams x where x.organization_id = v_organization_id and x.team_id = v_home_team_id and x.active)
         or not exists (select 1 from public.organization_teams x where x.organization_id = v_organization_id and x.team_id = v_away_team_id and x.active) then
        raise exception 'One or both teams are not active for this organization';
      end if;
      if not exists (select 1 from public.organization_locations x where x.organization_id = v_organization_id and x.location_id = v_location_id and x.active) then
        raise exception 'The selected location is not active for this organization';
      end if;
      if v_bill_to_id is not null and not exists (
        select 1 from public.bill_to_accounts x
        where x.id = v_bill_to_id and x.organization_id = v_organization_id and x.active
      ) then
        raise exception 'The selected Bill To is not active for this organization';
      end if;

      if v_row->>'action' = 'update' then
        update public.games
        set sport_id = (v_row->>'sport_id')::uuid,
            league_id = v_league_id,
            level_id = v_level_id,
            level = v_row->>'level_name',
            home_team_id = v_home_team_id,
            away_team_id = v_away_team_id,
            location_id = v_location_id,
            bill_to_id = v_bill_to_id,
            starts_at = (v_row->>'starts_at')::timestamptz,
            time_tbd = coalesce((v_row->>'time_tbd')::boolean, false),
            field_tbd = coalesce((v_row->>'field_tbd')::boolean, false),
            duration_minutes = (v_row->>'duration_minutes')::integer,
            officials_needed = (v_row->>'officials_needed')::integer,
            notes = nullif(v_row->>'notes', '')
        where id = (v_row->>'game_id')::uuid and organization_id = v_organization_id
        and private.can_manage_organization_league_location(organization_id,league_id,location_id,auth.uid());
        v_updated := v_updated + 1;
      else
        insert into public.games (
          organization_id, game_number, sport_id, league_id, level_id, level,
          home_team_id, away_team_id, location_id, bill_to_id, starts_at,
          time_tbd, field_tbd, duration_minutes, officials_needed, notes, status
        ) values (
          v_organization_id, nullif(v_row->>'game_number', ''),
          (v_row->>'sport_id')::uuid, v_league_id, v_level_id,
          v_row->>'level_name', v_home_team_id, v_away_team_id,
          v_location_id, v_bill_to_id, (v_row->>'starts_at')::timestamptz,
          coalesce((v_row->>'time_tbd')::boolean, false),
          coalesce((v_row->>'field_tbd')::boolean, false),
          (v_row->>'duration_minutes')::integer,
          (v_row->>'officials_needed')::integer,
          nullif(v_row->>'notes', ''), 'open'
        );
        v_added := v_added + 1;
      end if;
    exception when others then
      raise exception 'Spreadsheet row % — Game % — %',
        coalesce(v_row->>'row', '?'),
        coalesce(nullif(v_row->>'game_number', ''), 'NEW'), sqlerrm;
    end;
  end loop;

  return jsonb_build_object('added', v_added, 'updated', v_updated, 'skipped', v_skipped);
end;
$$;

create or replace function private.sync_organization_user_roles(
  p_organization_id uuid,p_user_id uuid,p_roles text[],p_viewer_permissions text[],p_league_ids uuid[]
) returns void language plpgsql security definer set search_path='' as $$
declare v_roles text[]:=coalesce(p_roles,'{}'::text[]);v_email text;v_official_id uuid;v_location_access jsonb;
begin
  if exists(select 1 from unnest(v_roles) role where role<>all(array['admin','assignor','official','mentor','registrar','viewer','billing','iowa_development_admin'])) then raise exception 'Invalid role selected.'; end if;
  if cardinality(v_roles)=0 then raise exception 'Select at least one role.'; end if;
  if not private.valid_viewer_permissions(coalesce(p_viewer_permissions,'{}'::text[])) then raise exception 'Invalid viewer permission.'; end if;
  if not private.valid_organization_league_ids(p_organization_id,coalesce(p_league_ids,'{}'::uuid[])) then raise exception 'A selected league is not connected to this organization.'; end if;
  if v_roles&&array['admin','assignor','mentor','registrar','viewer','billing']::text[] and cardinality(coalesce(p_league_ids,'{}'::uuid[]))=0 and not exists(select 1 from public.organization_memberships m where m.organization_id=p_organization_id and m.user_id=p_user_id and m.role='owner') then raise exception 'Select at least one league.'; end if;
  if 'viewer'=any(v_roles) and cardinality(coalesce(p_viewer_permissions,'{}'::text[]))=0 then raise exception 'Select at least one area this contact can view.'; end if;

  insert into public.organization_user_access_profiles(organization_id,user_id,roles,viewer_permissions,league_ids,updated_by)
  values(p_organization_id,p_user_id,v_roles,case when 'viewer'=any(v_roles) then p_viewer_permissions else '{}'::text[] end,p_league_ids,(select auth.uid()))
  on conflict(organization_id,user_id) do update set roles=excluded.roles,viewer_permissions=excluded.viewer_permissions,league_ids=excluded.league_ids,updated_at=now(),updated_by=excluded.updated_by;

  delete from public.organization_memberships where organization_id=p_organization_id and user_id=p_user_id and role<>'owner';
  insert into public.organization_memberships(organization_id,user_id,role,viewer_permissions)
  select p_organization_id,p_user_id,role,case when role='viewer' then
    case when 'viewer'=any(v_roles) then p_viewer_permissions else array['assignments']::text[] end else '{}'::text[] end
  from unnest(v_roles||case when 'mentor'=any(v_roles) and not('viewer'=any(v_roles)) then array['viewer']::text[] else '{}'::text[] end) role
  where role<>'official' on conflict(organization_id,user_id,role) do update set viewer_permissions=excluded.viewer_permissions;

  select coalesce(jsonb_agg(jsonb_build_object('league_id',a.league_id,'all_locations',a.all_locations,'location_ids',a.location_ids)),'[]'::jsonb) into v_location_access from public.organization_member_league_access a where a.organization_id=p_organization_id and a.user_id=p_user_id;
  delete from public.organization_member_league_access where organization_id=p_organization_id and user_id=p_user_id;
  insert into public.organization_member_league_access(organization_id,user_id,league_id)
  select p_organization_id,p_user_id,league_id from unnest(coalesce(p_league_ids,'{}'::uuid[])) league_id on conflict do nothing;
  update public.organization_member_league_access a set all_locations=(x->>'all_locations')::boolean, location_ids=array(select jsonb_array_elements_text(x->'location_ids')::uuid) from jsonb_array_elements(v_location_access) x where a.organization_id=p_organization_id and a.user_id=p_user_id and a.league_id=(x->>'league_id')::uuid;

  select lower(email) into v_email from auth.users where id=p_user_id;
  if 'official'=any(v_roles) then
    select id into v_official_id from public.officials where auth_user_id=p_user_id or lower(email)=v_email order by (auth_user_id=p_user_id) desc limit 1;
    if v_official_id is null then
      insert into public.officials(auth_user_id,full_name,first_name,last_name,email)
      values(p_user_id,split_part(v_email,'@',1),split_part(v_email,'@',1),'',v_email) returning id into v_official_id;
    else update public.officials set auth_user_id=p_user_id where id=v_official_id and auth_user_id is null; end if;
    insert into public.organization_officials(organization_id,official_id,active,added_by) values(p_organization_id,v_official_id,true,(select auth.uid()))
    on conflict(organization_id,official_id) do update set active=true;
    insert into public.user_roles(user_id,role) values(p_user_id,'official') on conflict do nothing;
  else
    update public.organization_officials oo set active=false from public.officials o where oo.organization_id=p_organization_id and oo.official_id=o.id and o.auth_user_id=p_user_id;
  end if;

  delete from public.league_staff_access where user_id=p_user_id and role='registrar' and league_id in(select league_id from public.organization_league_coverage where organization_id=p_organization_id);
  if 'registrar'=any(v_roles) then
    insert into public.league_staff_access(user_id,league_id,role) select p_user_id,league_id,'registrar' from unnest(p_league_ids) league_id on conflict do nothing;
    insert into public.user_roles(user_id,role) values(p_user_id,'registrar') on conflict do nothing;
  end if;
end $$;

create or replace function private.set_organization_invitation_roles_impl(p_invitation_id uuid,p_roles text[],p_viewer_permissions text[],p_league_ids uuid[])
returns void language plpgsql security definer set search_path='' as $$ declare v_org uuid;begin
 select organization_id into v_org from public.organization_invitations where id=p_invitation_id and status='pending';
 if v_org is null or not private.can_manage_organization(v_org) then raise exception 'Pending invitation was not found or access was denied.'; end if;
 if exists(select 1 from unnest(p_roles) role where role<>all(array['admin','assignor','official','mentor','registrar','viewer','billing','iowa_development_admin'])) or cardinality(p_roles)=0 then raise exception 'Select valid roles.'; end if;
 if p_roles&&array['admin','assignor','mentor','registrar','viewer','billing']::text[] and cardinality(p_league_ids)=0 then raise exception 'Select at least one league.'; end if;
 update public.organization_invitations set roles=p_roles,viewer_permissions=case when 'viewer'=any(p_roles) then p_viewer_permissions else '{}'::text[] end,league_ids=p_league_ids where id=p_invitation_id;
end $$;

create or replace function public.set_organization_user_roles(p_organization_id uuid,p_user_id uuid,p_roles text[],p_viewer_permissions text[] default '{}'::text[],p_league_ids uuid[] default '{}'::uuid[])
returns void language plpgsql security definer set search_path='' as $$ begin
 if not private.can_manage_organization(p_organization_id) then raise exception 'Only organization owners can change team access.'; end if;
 perform private.sync_organization_user_roles(p_organization_id,p_user_id,p_roles,p_viewer_permissions,p_league_ids);
end $$;

-- Sync remains callable only from checked SECURITY DEFINER entry points.
revoke all on function private.sync_organization_user_roles(uuid,uuid,text[],text[],uuid[]) from public,anon,authenticated;
revoke all on function public.set_organization_user_roles(uuid,uuid,text[],text[],uuid[]) from public,anon;
grant execute on function public.set_organization_user_roles(uuid,uuid,text[],text[],uuid[]) to authenticated;


create or replace function private.can_manage_any_organization_league(p_organization_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select private.can_manage_organization(p_organization_id) or exists(select 1 from public.organization_league_coverage c where c.organization_id=p_organization_id and private.can_manage_organization_league(c.organization_id,c.league_id,(select auth.uid())));
$$;
create or replace function private.can_manage_scoped_league(p_league_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.organization_league_coverage c where c.league_id=p_league_id and private.can_manage_organization_league_settings(c.organization_id,c.league_id));
$$;
create or replace function public.can_read_league_document(p_league_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select private.can_read_scoped_resource('league',p_league_id);
$$;
revoke all on function private.can_manage_any_organization_league(uuid),private.can_manage_scoped_league(uuid) from public,anon;
grant execute on function private.can_manage_any_organization_league(uuid),private.can_manage_scoped_league(uuid) to authenticated,service_role;
drop policy "Staff add league documents" on public.league_documents;
create policy "Staff add league documents" on public.league_documents for insert to authenticated
 with check(private.can_manage_scoped_league(league_id) and uploaded_by=(select auth.uid()) and split_part(storage_path,'/',1)=league_id::text);
drop policy "Staff remove league documents" on public.league_documents;
create policy "Staff remove league documents" on public.league_documents for delete to authenticated using(private.can_manage_scoped_league(league_id));
drop policy "Staff upload league files" on storage.objects;
create policy "Staff upload league files" on storage.objects for insert to authenticated
 with check(bucket_id='league-documents' and exists(select 1 from public.leagues l where l.id::text=(storage.foldername(storage.objects.name))[1] and private.can_manage_scoped_league(l.id)));
drop policy "Staff remove league files" on storage.objects;
create policy "Staff remove league files" on storage.objects for delete to authenticated
 using(bucket_id='league-documents' and exists(select 1 from public.leagues l where l.id::text=(storage.foldername(storage.objects.name))[1] and private.can_manage_scoped_league(l.id)));

-- Legacy profile grants on game-related support tables cannot bypass game scope.
do $game_policy_fences$
declare row record; command text;
begin
 for row in select * from (values
  ('assignment_declines',false),('assignment_self_assign_slots',true),('contact_game_messages',false),
  ('game_crew_messages',false),('game_updates',true)
 ) r(table_name,manager_writes) loop
  execute format('create policy "Game scope read fence" on public.%I as restrictive for select to authenticated using(private.can_read_organization_game(game_id,(select auth.uid())))',row.table_name);
  if row.manager_writes then
   foreach command in array array['insert','update','delete'] loop
    execute format('create policy %I on public.%I as restrictive for %s to authenticated %s %s','Game scope '||command||' fence',row.table_name,command,
      case when command<>'insert' then 'using(private.can_manage_game(game_id))' else '' end,
      case when command<>'delete' then 'with check(private.can_manage_game(game_id))' else '' end);
   end loop;
  end if;
 end loop;
 for row in select * from (values ('official_mentor_certifications'),('official_soccer_position_rankings'),('official_weekday_origins')) r(table_name) loop
  execute format('create policy "Official scope read fence" on public.%I as restrictive for select to authenticated using(private.can_read_scoped_resource(''official'',official_id))',row.table_name);
  foreach command in array array['insert','update','delete'] loop
   execute format('create policy %I on public.%I as restrictive for %s to authenticated %s %s','Shared official '||command||' fence',row.table_name,command,
    case when command<>'insert' then 'using(private.can_manage_shared_resource(''official'',official_id)'||case when row.table_name='official_weekday_origins' then ' or exists(select 1 from public.officials o where o.id=official_id and o.auth_user_id=(select auth.uid()))' else '' end||')' else '' end,
    case when command<>'delete' then 'with check(private.can_manage_shared_resource(''official'',official_id)'||case when row.table_name='official_weekday_origins' then ' or exists(select 1 from public.officials o where o.id=official_id and o.auth_user_id=(select auth.uid()))' else '' end||')' else '' end);
  end loop;
 end loop;
end $game_policy_fences$;

-- Bills are shared organization records. Existing game-attached identifiers are
-- readable for in-scope games; changing shared billing identity stays owner-only.
create policy "League scope read fence" on public.bill_to_accounts as restrictive for select to authenticated
 using(private.can_manage_organization(organization_id) or exists(select 1 from public.games g where g.organization_id=bill_to_accounts.organization_id and g.bill_to_id=bill_to_accounts.id and private.can_access_organization_league_location(g.organization_id,g.league_id,g.location_id,(select auth.uid()))));

create or replace function private.can_access_link_group(p_group_id uuid,p_manage boolean default false)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.game_link_groups grp where grp.id=p_group_id and (
  private.can_manage_organization(grp.organization_id) or (
   private.can_manage_any_organization_league(grp.organization_id)
   and (grp.created_by=(select auth.uid()) or exists(select 1 from public.game_link_members m where m.group_id=grp.id))
   and not exists(select 1 from public.game_link_members m left join public.games g on g.id=m.game_id
    where m.group_id=grp.id and (g.id is null or g.organization_id is distinct from grp.organization_id
      or not case when p_manage then private.can_manage_game(g.id) else private.can_read_organization_game(g.id,(select auth.uid())) end))
  )));
$$;
create or replace function private.can_manage_link_member(p_group_id uuid,p_game_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select private.can_access_link_group(p_group_id,true) and private.can_manage_game(p_game_id)
 and exists(select 1 from public.game_link_groups grp join public.games g on g.organization_id=grp.organization_id where grp.id=p_group_id and g.id=p_game_id);
$$;
create or replace function private.require_linked_game_scope(p_game_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare group_id uuid;
begin
 if not private.can_manage_game(p_game_id) then raise exception 'Game is outside your access.' using errcode='42501'; end if;
 select m.group_id into group_id from public.game_link_members m where m.game_id=p_game_id;
 if group_id is not null then
  perform 1 from public.game_link_groups grp where grp.id=group_id for update;
  if not private.can_access_link_group(group_id,true) then raise exception 'Every linked game must be inside your access.' using errcode='42501'; end if;
 end if;
end $$;
revoke all on function private.can_access_link_group(uuid,boolean),private.can_manage_link_member(uuid,uuid),private.require_linked_game_scope(uuid) from public,anon;
grant execute on function private.can_access_link_group(uuid,boolean),private.can_manage_link_member(uuid,uuid),private.require_linked_game_scope(uuid) to authenticated,service_role;
create policy "Linked scope read fence" on public.game_link_groups as restrictive for select to authenticated using(private.can_access_link_group(id,false));
create policy "Scoped managers create link groups" on public.game_link_groups for insert to authenticated with check(private.can_manage_any_organization_league(organization_id) and created_by=(select auth.uid()));
create policy "Scoped managers update link groups" on public.game_link_groups for update to authenticated using(private.can_access_link_group(id,true)) with check(private.can_access_link_group(id,true) and private.can_manage_any_organization_league(organization_id));
create policy "Scoped managers remove link groups" on public.game_link_groups for delete to authenticated using(private.can_access_link_group(id,true));
create policy "Linked scope read fence" on public.game_link_members as restrictive for select to authenticated using(private.can_access_link_group(group_id,false) and private.can_read_organization_game(game_id,(select auth.uid())));
create policy "Scoped managers add link members" on public.game_link_members for insert to authenticated with check(private.can_manage_link_member(group_id,game_id));
create policy "Scoped managers update link members" on public.game_link_members for update to authenticated using(private.can_manage_link_member(group_id,game_id)) with check(private.can_manage_link_member(group_id,game_id));
create policy "Scoped managers remove link members" on public.game_link_members for delete to authenticated using(private.can_manage_link_member(group_id,game_id));

-- Templates with no league are intentionally shared and remain owner-managed.
create policy "League scope read fence" on public.assignment_templates as restrictive for select to authenticated
 using(private.can_manage_organization(organization_id) or (league_id is not null and private.can_access_organization_league(organization_id,league_id,(select auth.uid()))));
create policy "Scoped managers manage league templates" on public.assignment_templates for all to authenticated
 using(private.can_manage_organization_league_settings(organization_id,league_id))
 with check(private.can_manage_organization_league_settings(organization_id,league_id) and created_by=(select auth.uid()));
create policy "League scope read fence" on public.assignment_template_slots as restrictive for select to authenticated
 using(exists(select 1 from public.assignment_templates t where t.id=template_id));
create policy "Scoped managers manage league template slots" on public.assignment_template_slots for all to authenticated
 using(exists(select 1 from public.assignment_templates t where t.id=template_id and private.can_manage_organization_league_settings(t.organization_id,t.league_id)))
 with check(exists(select 1 from public.assignment_templates t where t.id=template_id and private.can_manage_organization_league_settings(t.organization_id,t.league_id)) and private.can_read_scoped_resource('official',official_id));

-- Check-ins are keyed by assignment, not by game.
create policy "Game scope read fence" on public.assignment_check_ins as restrictive for select to authenticated
 using(exists(select 1 from public.assignments a where a.id=assignment_id and private.can_read_organization_game(a.game_id,(select auth.uid()))));
create policy "Game scope insert fence" on public.assignment_check_ins as restrictive for insert to authenticated
 with check(exists(select 1 from public.assignments a where a.id=assignment_id and private.can_manage_game(a.game_id)));
create policy "Game scope update fence" on public.assignment_check_ins as restrictive for update to authenticated
 using(exists(select 1 from public.assignments a where a.id=assignment_id and private.can_manage_game(a.game_id)))
 with check(exists(select 1 from public.assignments a where a.id=assignment_id and private.can_manage_game(a.game_id)));
create policy "Game scope delete fence" on public.assignment_check_ins as restrictive for delete to authenticated
 using(exists(select 1 from public.assignments a where a.id=assignment_id and private.can_manage_game(a.game_id)));

-- Legacy role flags never confer global operational authority. Scoped callers
-- use organization/league/game predicates; platform catalog editing is protected.
create or replace function public.is_refassign_staff()
returns boolean language sql stable security definer set search_path='' as $$ select public.is_super_admin(); $$;
create or replace function public.can_manage_game_setup()
returns boolean language sql stable security definer set search_path='' as $$ select public.is_super_admin(); $$;
create policy "Users manage own saved assignment filters" on public.assignment_saved_views for all to authenticated
 using(user_id=(select auth.uid())) with check(user_id=(select auth.uid()));
-- Contact identity/access and globally shared sports are not league resources.
do $global_resource_fences$
declare t text; command text; predicate text;
begin
 foreach t in array array['contacts','contact_league_access','contact_level_access','contact_location_access','contact_team_access','sports','sport_positions','venues'] loop
  foreach command in array array['insert','update','delete'] loop
   predicate:='public.is_super_admin()';
   if t='contacts' then predicate:='private.can_manage_organization(organization_id)'; end if;
   if t like 'contact_%_access' then predicate:='exists(select 1 from public.contacts c where c.id=contact_id and private.can_manage_organization(c.organization_id))'; end if;
   execute format('create policy %I on public.%I as restrictive for %s to authenticated %s %s','Shared catalog '||command||' fence',t,command,
     case when command<>'insert' then 'using('||predicate||')' else '' end,
     case when command<>'delete' then 'with check('||predicate||')' else '' end);
  end loop;
 end loop;
end $global_resource_fences$;
create policy "Venue scope read fence" on public.venues as restrictive for select to authenticated
 using(public.is_super_admin() or exists(select 1 from public.locations l where l.venue_id=venues.id and private.can_read_scoped_resource('location',l.id)));

-- Preserve organization-owner/shared-roster and personal self-service origins
-- after removing the old worldwide profile-role shortcut.
create policy "Scoped users read official weekday origins" on public.official_weekday_origins for select to authenticated
 using(private.can_read_scoped_resource('official',official_id));
create policy "Owners add official weekday origins" on public.official_weekday_origins for insert to authenticated
 with check(private.can_manage_shared_resource('official',official_id));
create policy "Owners update official weekday origins" on public.official_weekday_origins for update to authenticated
 using(private.can_manage_shared_resource('official',official_id)) with check(private.can_manage_shared_resource('official',official_id));
create policy "Scoped users read venues" on public.venues for select to authenticated
 using(public.is_super_admin() or exists(select 1 from public.locations l where l.venue_id=venues.id and private.can_read_scoped_resource('location',l.id)));

create or replace function private.normalize_league_location_access(p_organization_id uuid,p_league_ids uuid[],p_league_access jsonb)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare item jsonb; lid uuid; ids uuid[]; all_sites boolean; result jsonb:='[]'::jsonb;
begin
 if not private.valid_organization_league_ids(p_organization_id,coalesce(p_league_ids,'{}'::uuid[])) then raise exception 'A selected league is not connected to this organization.'; end if;
 if jsonb_typeof(p_league_access) is distinct from 'array' then raise exception 'Choose All locations or specific locations for each league.'; end if;
 if exists(select 1 from jsonb_array_elements(p_league_access) x where not coalesce((x->>'league_id')::uuid=any(coalesce(p_league_ids,'{}'::uuid[])),false))
 or exists(select 1 from jsonb_array_elements(p_league_access) x group by x->>'league_id' having count(*)>1) then raise exception 'Location access must match selected leagues.'; end if;
 foreach lid in array coalesce(p_league_ids,'{}'::uuid[]) loop
  select x into item from jsonb_array_elements(p_league_access) x where (x->>'league_id')::uuid=lid;
  -- Omitted metadata is always denial, never All locations.
  if item is null then item:=jsonb_build_object('all_locations',false,'location_ids','[]'::jsonb); end if;
  if jsonb_typeof(item->'all_locations') is distinct from 'boolean' or jsonb_typeof(item->'location_ids') is distinct from 'array' then raise exception 'Invalid league location access.'; end if;
  all_sites:=(item->>'all_locations')::boolean;
  select coalesce(array_agg(distinct x::uuid),'{}'::uuid[]) into ids from jsonb_array_elements_text(item->'location_ids') x;
  if exists(select 1 from unnest(ids) loc where not exists(select 1 from public.organization_locations ol join public.locations l on l.id=ol.location_id where ol.organization_id=p_organization_id and ol.location_id=loc and ol.active and l.active)) then raise exception 'A selected location is not active in this organization.'; end if;
  result:=result||jsonb_build_array(jsonb_build_object('league_id',lid,'all_locations',all_sites,'location_ids',case when all_sites then '{}'::uuid[] else ids end));
 end loop;
 return result;
end $$;
revoke all on function private.normalize_league_location_access(uuid,uuid[],jsonb) from public,anon,authenticated;

create or replace function private.apply_user_league_location_access(p_organization_id uuid,p_user_id uuid,p_league_ids uuid[],p_league_access jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare normalized jsonb:=private.normalize_league_location_access(p_organization_id,p_league_ids,p_league_access);
begin
 update public.organization_member_league_access a set
  all_locations=(x.value->>'all_locations')::boolean,
  location_ids=array(select jsonb_array_elements_text(x.value->'location_ids')::uuid)
 from jsonb_array_elements(normalized) x where a.organization_id=p_organization_id and a.user_id=p_user_id and a.league_id=(x.value->>'league_id')::uuid;
end $$;
revoke all on function private.apply_user_league_location_access(uuid,uuid,uuid[],jsonb) from public,anon,authenticated;

-- Replace public signatures rather than leaving an ambiguous optional overload.
drop function public.set_organization_user_roles(uuid,uuid,text[],text[],uuid[]);
create function public.set_organization_user_roles(p_organization_id uuid,p_user_id uuid,p_roles text[],p_viewer_permissions text[] default '{}'::text[],p_league_ids uuid[] default '{}'::uuid[],p_league_access jsonb default null)
returns void language plpgsql security definer set search_path='' as $$
begin
 if not private.can_manage_organization(p_organization_id) then raise exception 'Only organization owners can change team access.' using errcode='42501'; end if;
 perform private.sync_organization_user_roles(p_organization_id,p_user_id,p_roles,p_viewer_permissions,p_league_ids);
 -- Old clients preserve the existing restrictions through sync. Newly selected
 -- leagues remain deny-by-default unless an owner supplies explicit choices.
 if p_league_access is not null then perform private.apply_user_league_location_access(p_organization_id,p_user_id,p_league_ids,p_league_access); end if;
end $$;
revoke all on function public.set_organization_user_roles(uuid,uuid,text[],text[],uuid[],jsonb) from public,anon;
grant execute on function public.set_organization_user_roles(uuid,uuid,text[],text[],uuid[],jsonb) to authenticated;

drop function public.set_organization_invitation_roles(uuid,text[],text[],uuid[]);
create function public.set_organization_invitation_roles(p_invitation_id uuid,p_roles text[],p_viewer_permissions text[] default '{}'::text[],p_league_ids uuid[] default '{}'::uuid[],p_league_access jsonb default null)
returns void language plpgsql security definer set search_path='' as $$
declare org uuid; old_access jsonb;
begin
 select organization_id,league_access into org,old_access from public.organization_invitations where id=p_invitation_id and status='pending' for update;
 if org is null or not private.can_manage_organization(org) then raise exception 'Only organization owners can change invitations.' using errcode='42501'; end if;
 perform private.set_organization_invitation_roles_impl(p_invitation_id,p_roles,p_viewer_permissions,p_league_ids);
 update public.organization_invitations set league_access=private.normalize_league_location_access(org,p_league_ids,
  coalesce(p_league_access,(select coalesce(jsonb_agg(x),'[]'::jsonb) from jsonb_array_elements(old_access) x where (x->>'league_id')::uuid=any(p_league_ids)))) where id=p_invitation_id;
end $$;
revoke all on function public.set_organization_invitation_roles(uuid,text[],text[],uuid[],jsonb) from public,anon;
grant execute on function public.set_organization_invitation_roles(uuid,text[],text[],uuid[],jsonb) to authenticated;

-- The durable invitation is created with its location scope in one transaction.
drop function public.create_organization_invitation(uuid,text,text,text[],uuid[]);
create function public.create_organization_invitation(p_organization_id uuid,p_email text,p_role text,p_viewer_permissions text[] default '{}'::text[],p_league_ids uuid[] default '{}'::uuid[],p_league_access jsonb default '[]'::jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
declare invitation_id uuid; normalized jsonb;
begin
 if not private.can_manage_organization(p_organization_id) then raise exception 'Only organization owners can invite teammates.' using errcode='42501'; end if;
 normalized:=private.normalize_league_location_access(p_organization_id,p_league_ids,p_league_access);
 invitation_id:=private.create_organization_invitation_impl(p_organization_id,p_email,p_role,p_viewer_permissions,p_league_ids);
 update public.organization_invitations set league_access=normalized where id=invitation_id;
 return invitation_id;
end $$;
revoke all on function public.create_organization_invitation(uuid,text,text,text[],uuid[],jsonb) from public,anon;
grant execute on function public.create_organization_invitation(uuid,text,text,text[],uuid[],jsonb) to authenticated;
create or replace function public.publish_game_assignments(p_game_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
  v_now timestamptz := now();
  v_organization_id uuid;
  v_league_id uuid;
begin
  select game.organization_id, game.league_id
  into v_organization_id, v_league_id
  from public.games game
  where game.id = p_game_id;

  if v_organization_id is null or v_league_id is null
     or not private.can_manage_game(p_game_id) then
    raise exception 'You cannot publish assignments for this organization.';
  end if;

  if exists (
    select 1
    from public.assignments assignment
    left join public.organization_officials organization_official
      on organization_official.organization_id = v_organization_id
     and organization_official.official_id = assignment.official_id
     and organization_official.active
    where assignment.game_id = p_game_id
      and assignment.official_id is not null
      and organization_official.official_id is null
  ) then
    raise exception 'Every assigned official must be active in this organization before publishing.';
  end if;

  update public.assignments
  set published_at = v_now,
      accept_by = v_now + interval '24 hours',
      published_by = (select auth.uid()),
      status = 'proposed',
      response_token = coalesce(response_token, gen_random_uuid()),
      responded_at = null,
      decline_reason = null
  where game_id = p_game_id
    and published_at is null;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create or replace function public.set_game_status(p_game_id uuid, p_status text)
returns public.games
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_game public.games;
  v_organization_id uuid;
  v_league_id uuid;
begin
  select game.organization_id, game.league_id
  into v_organization_id, v_league_id
  from public.games game
  where game.id = p_game_id;

  if v_organization_id is null or v_league_id is null
     or not private.can_manage_game(p_game_id) then
    raise exception 'You cannot change status for this organization.';
  end if;
  if p_status not in ('active','canceled','suspended','rained_out') then
    raise exception 'Invalid game status';
  end if;

  update public.games set status = p_status where id = p_game_id returning * into v_game;

  if p_status in ('canceled','rained_out') then
    update public.assignments
    set status_before_cancellation = case when status <> 'cancelled' then status else status_before_cancellation end,
        status = 'cancelled', accept_by = null,
        cancellation_notified_at = null, cancellation_email_id = null, cancellation_email_error = null
    where game_id = p_game_id and status <> 'declined';
    update public.assignment_self_assign_slots set status = 'withdrawn'
    where game_id = p_game_id and status = 'open';
  elsif p_status = 'active' then
    update public.assignments
    set status = coalesce(status_before_cancellation,'proposed'), status_before_cancellation = null,
        cancellation_notified_at = null, cancellation_email_id = null, cancellation_email_error = null
    where game_id = p_game_id and status = 'cancelled';
  end if;

  return v_game;
end;
$$;

create or replace function public.review_self_assign_override(p_request_id uuid,p_approve boolean)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_request public.self_assign_override_requests%rowtype;v_slot public.assignment_self_assign_slots%rowtype;
  v_game public.games%rowtype;v_assignment uuid;
begin
  select * into v_request from public.self_assign_override_requests where id=p_request_id and status='pending' for update;
  select * into v_slot from public.assignment_self_assign_slots where id=v_request.slot_id for update;
  select * into v_game from public.games where id=v_slot.game_id;
  if v_request.id is null or not private.can_manage_game(v_game.id) then raise exception 'Not authorized'; end if;
  if not p_approve then update public.self_assign_override_requests set status='denied',reviewed_at=now(),reviewed_by=(select auth.uid()) where id=p_request_id; return null; end if;
  if v_slot.status<>'open' then raise exception 'This position is no longer available'; end if;
  insert into public.assignments(game_id,official_id,position_id,status,assigned_at,published_at,published_by,response_token,responded_at,assignment_source)
  values(v_slot.game_id,v_request.official_id,v_slot.position_id,'accepted',now(),now(),(select auth.uid()),gen_random_uuid(),now(),'self_assign') returning id into v_assignment;
  update public.assignment_self_assign_slots set status='claimed',claimed_by=v_request.official_id,claimed_at=now() where id=v_slot.id;
  update public.self_assign_override_requests set status='approved',reviewed_at=now(),reviewed_by=(select auth.uid()) where id=p_request_id;
  update public.self_assign_override_requests set status='denied',reviewed_at=now(),reviewed_by=(select auth.uid()) where slot_id=v_slot.id and id<>p_request_id and status='pending';
  return v_assignment;
end;$$;

create or replace function public.get_assignment_candidate_conflicts(
  p_target_game_ids uuid[]
)
returns table(target_game_id uuid, official_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select distinct
    target.id as target_game_id,
    assignment.official_id
  from public.games target
  join public.organization_officials candidate
    on candidate.organization_id = target.organization_id
   and candidate.active
  join public.assignments assignment
    on assignment.official_id = candidate.official_id
   and lower(coalesce(assignment.status, '')) not in
       ('declined', 'cancelled', 'canceled')
  join public.games occupied
    on occupied.id = assignment.game_id
   and occupied.id <> target.id
   and occupied.starts_at is not null
   and lower(coalesce(occupied.status, 'active')) not in
       ('cancelled', 'canceled', 'rained_out', 'rain_out')
  where target.id = any(coalesce(p_target_game_ids, '{}'::uuid[]))
    and target.starts_at is not null
    and lower(coalesce(target.status, 'active')) not in
        ('cancelled', 'canceled', 'rained_out', 'rain_out')
    and private.can_manage_game(target.id)
    and occupied.starts_at
          < target.starts_at
            + pg_catalog.make_interval(
                mins => coalesce(target.duration_minutes, 110)
              )
    and occupied.starts_at
          + pg_catalog.make_interval(
              mins => coalesce(occupied.duration_minutes, 110)
            )
          > target.starts_at;
$$;

create or replace function public.confirm_calendar_game_review(p_game_ids uuid[])
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_user_id uuid := (select auth.uid());
  v_reviewed integer;
  v_confirmed_ids uuid[];
begin
  if v_user_id is null then raise exception 'Sign in to confirm calendar game review.' using errcode='42501'; end if;
  if coalesce(cardinality(p_game_ids),0)=0 then raise exception 'Select at least one calendar game to review.'; end if;
  -- Authorize the entire selection before changing any row, including cross-league selections.
  if exists (
    select 1 from (select distinct unnest(p_game_ids) id) requested
    left join public.games g on g.id=requested.id
    where g.id is null or not coalesce(private.can_manage_organization_league_location(g.organization_id,g.league_id,g.location_id,v_user_id),false)
  ) then
    raise exception 'You cannot confirm review for one or more selected games.' using errcode='42501';
  end if;
  update public.games
  set calendar_needs_review=false,calendar_reviewed_at=now(),calendar_reviewed_by=v_user_id
  where id=any(p_game_ids) and calendar_needs_review and source_system in ('gobound','ical','calendar');
  get diagnostics v_reviewed = row_count;
  select coalesce(array_agg(id),'{}'::uuid[]) into v_confirmed_ids from public.games
  where id=any(p_game_ids) and not calendar_needs_review and calendar_reviewed_at is not null;
  return jsonb_build_object('reviewed',v_reviewed,'confirmed_ids',v_confirmed_ids);
end;
$$;

create or replace function public.review_and_release_bound_game(p_game_id uuid,p_expected_hold_checked_at timestamptz)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 actor uuid := auth.uid(); g public.games; before_game jsonb; outcome text;
 previous_sync text := current_setting('refassign.bound_sync',true);
begin
 if actor is null then raise exception 'Sign in to review and release a hold.' using errcode='42501'; end if;
 select * into g from public.games where id=p_game_id;
 if not found or not coalesce(private.can_manage_organization_league_location(g.organization_id,g.league_id,g.location_id,actor),false) then
  raise exception 'You cannot review and release this game.' using errcode='42501';
 end if;
 perform pg_advisory_xact_lock(hashtextextended(g.organization_id::text||':gobound',0));
 -- Prevent new or edited peers appearing between the live overlap check and
 -- activation. Kept only for this short transaction; no external work occurs.
 lock table public.games in share row exclusive mode;
 select * into g from public.games where id=p_game_id for update;
 if not coalesce(private.can_manage_organization_league_location(g.organization_id,g.league_id,g.location_id,actor),false) then
  raise exception 'You cannot review and release this game.' using errcode='42501';
 end if;
 if g.source_system is distinct from 'gobound' or g.archived_at is not null then raise exception 'Only current Bound calendar holds can be reviewed here.'; end if;
 if p_expected_hold_checked_at is null or g.bound_hold_checked_at is distinct from p_expected_hold_checked_at
    or g.bound_hold_checked_game is distinct from private.bound_hold_game_signature(g) then
  raise exception 'This game changed since its last hold check. Refresh the calendar and review it again.' using errcode='40001';
 end if;
 before_game:=to_jsonb(g);
 if g.status='canceled' or g.bound_source_status='CANCELLED' then
  if g.status<>'canceled' then raise exception 'Refresh the calendar to reconcile the source cancellation first.'; end if;
  outcome:='canceled_reviewed';
 elsif g.status='active' and not g.venue_conflict_hold and not g.calendar_needs_review and g.calendar_reviewed_at is not null then
  return jsonb_build_object('outcome','already_released','status',g.status,'reviewed',false,'released',false,'game_id',g.id);
 else
  if g.status<>'suspended' or not g.venue_conflict_hold or not g.bound_hold_resolution_candidate or cardinality(g.bound_hold_reasons)>0
     or g.bound_source_status is distinct from 'CONFIRMED' then
   raise exception 'This hold is not eligible for release. Resolve its blockers and recheck the calendar first.' using errcode='23514';
  end if;
  if g.time_tbd or g.field_tbd or g.location_id is null or g.level_id is null or g.home_team_id is null or g.away_team_id is null
     or g.duration_minutes not between 1 and 1440
     or exists(select 1 from public.teams t where t.id in(g.home_team_id,g.away_team_id) and (t.source_system='refassign-placeholder' or t.name ilike '%TBD%')) then raise exception 'Confirm the game details before releasing this hold.' using errcode='23514'; end if;
  if exists(select 1 from public.games x where x.id<>g.id and x.organization_id=g.organization_id and x.archived_at is null
      and not x.time_tbd and x.status not in('canceled','cancelled','rained_out')
      and x.starts_at<g.starts_at+make_interval(mins=>g.duration_minutes)
      and x.starts_at+make_interval(mins=>x.duration_minutes)>g.starts_at
      and ((not x.field_tbd and x.location_id=g.location_id)
       or exists(select 1 from public.teams t where t.id in(g.home_team_id,g.away_team_id) and t.id in(x.home_team_id,x.away_team_id) and coalesce(t.source_system,'')<>'refassign-placeholder'))) then
   raise exception 'A current resource overlap still blocks release. Refresh the calendar and resolve it first.' using errcode='23514';
  end if;
  outcome:='released';
 end if;
 if outcome='canceled_reviewed' and not g.calendar_needs_review and g.calendar_reviewed_at is not null then
  return jsonb_build_object('outcome',outcome,'status',g.status,'reviewed',false,'released',false,'game_id',g.id);
 end if;
 perform set_config('refassign.bound_sync','on',true);
 update public.games set status=case when outcome='released' then 'active' else status end,
  calendar_needs_review=false,calendar_reviewed_at=now(),calendar_reviewed_by=actor,
  bound_hold_resolution_candidate=false where id=g.id returning * into g;
 update public.games set bound_hold_checked_game=private.bound_hold_game_signature(g) where id=g.id;
 insert into public.audit_history(organization_id,entity_type,entity_id,game_id,action,actor_user_id,summary,old_data,new_data)
 values(g.organization_id,'game',g.id,g.id,'bound_review_release',actor,
  case when outcome='released' then 'Reviewed and released resolved Bound resource hold.' else 'Reviewed source cancellation; game remains canceled.' end,before_game,to_jsonb(g));
 perform set_config('refassign.bound_sync',coalesce(previous_sync,'off'),true);
 return jsonb_build_object('outcome',outcome,'status',g.status,'reviewed',true,'released',outcome='released','game_id',g.id);
end;
$$;

create or replace function private.get_or_create_league_connection_link_impl(
  p_organization_id uuid,
  p_league_id uuid,
  p_regenerate boolean default false
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token uuid;
begin
  if not private.can_manage_organization(p_organization_id) then raise exception 'Only organization owners can create connection links.' using errcode='42501'; end if;

  if not exists (
    select 1
    from public.organization_league_coverage coverage
    join public.leagues league on league.id = coverage.league_id
    where coverage.organization_id = p_organization_id
      and coverage.league_id = p_league_id
      and coverage.active
      and league.active
  ) then
    raise exception 'This league is archived or is not active for the selected organization.';
  end if;

  insert into public.league_official_connection_links (
    organization_id, league_id, created_by
  ) values (
    p_organization_id, p_league_id, (select auth.uid())
  )
  on conflict (organization_id, league_id) do update
  set token = case
        when p_regenerate then gen_random_uuid()
        else public.league_official_connection_links.token
      end,
      active = true,
      updated_at = now(),
      created_by = case
        when p_regenerate then (select auth.uid())
        else public.league_official_connection_links.created_by
      end
  returning token into v_token;

  return v_token;
end;
$$;

create or replace function public.assign_official_to_linked_games(
  p_game_id uuid, p_position_id uuid, p_official_id uuid
) returns integer language plpgsql security invoker set search_path='public' as $$
declare v_group_id uuid; v_source_slot integer; v_target_position uuid;
  v_existing_position uuid; v_existing_assignment uuid;
  v_official_assignment uuid; v_count integer:=0; v_game record;
begin
  if not private.can_manage_game(p_game_id) then raise exception 'Only Administrators and Assignors can manage assignments'; end if;
  perform private.require_linked_game_scope(p_game_id);
  if p_official_id is null then raise exception 'An official is required'; end if;
  select ranked.slot into v_source_slot from (
    select sp.id,row_number() over(order by sp.sort_order,sp.id)-1 as slot
    from public.sport_positions sp where sp.sport_id=(select sport_id from public.sport_positions where id=p_position_id)
  ) ranked where ranked.id=p_position_id;
  if v_source_slot is null then raise exception 'Assignment position not found'; end if;
  select group_id into v_group_id from public.game_link_members where game_id=p_game_id;
  for v_game in select g.id,g.sport_id,g.officials_needed from public.games g
    where g.id=p_game_id or (v_group_id is not null and g.id in
      (select game_id from public.game_link_members where group_id=v_group_id))
    order by g.starts_at,g.id
  loop
    select id into v_target_position from public.sport_positions where sport_id=v_game.sport_id
      order by sort_order,id offset v_source_slot limit 1;
    if v_target_position is null or v_source_slot>=greatest(v_game.officials_needed,0) then
      raise exception 'A linked game does not have the matching assignment position';
    end if;
    select id,position_id into v_official_assignment,v_existing_position from public.assignments
      where game_id=v_game.id and official_id=p_official_id for update;
    select id into v_existing_assignment from public.assignments
      where game_id=v_game.id and position_id=v_target_position and status<>'declined'
      order by assigned_at desc limit 1 for update;
    if v_official_assignment is not null and v_existing_position is distinct from v_target_position then
      raise exception 'The official is already assigned to a different position on a linked game';
    end if;
    if v_existing_assignment is not null then
      update public.assignments set official_id=p_official_id,status='proposed',published_at=null,
        accept_by=null,published_by=null,email_sent_at=null,resend_email_id=null,email_error=null,
        response_token=null,responded_at=null,decline_reason=null where id=v_existing_assignment;
    elsif v_official_assignment is null then
      insert into public.assignments(game_id,official_id,position_id,status)
      values(v_game.id,p_official_id,v_target_position,'proposed');
    end if;
    v_count:=v_count+1; v_target_position:=null; v_existing_position:=null;
    v_existing_assignment:=null; v_official_assignment:=null;
  end loop;
  return v_count;
end; $$;

create or replace function public.move_assignment_position(
  p_game_id uuid,p_assignment_id uuid,p_direction integer
) returns void language plpgsql security invoker set search_path='public' as $$
declare v_source record; v_target_position uuid; v_target_assignment uuid;
begin
  if not private.can_manage_game(p_game_id) then raise exception 'Only Administrators and Assignors can manage assignments'; end if;
  if p_direction not in (-1,1) then raise exception 'Direction must be -1 or 1'; end if;
  select a.position_id,g.sport_id,g.officials_needed,
    (select count(*) from public.sport_positions preceding where preceding.sport_id=g.sport_id
      and (preceding.sort_order<sp.sort_order or (preceding.sort_order=sp.sort_order and preceding.id<sp.id)))::integer as slot
    into v_source from public.assignments a join public.games g on g.id=a.game_id
    join public.sport_positions sp on sp.id=a.position_id
    where a.id=p_assignment_id and a.game_id=p_game_id for update of a;
  if not found then raise exception 'Assignment not found'; end if;
  select positions.id into v_target_position from (
    select sp.id,row_number() over(order by sp.sort_order,sp.id)-1 as slot
    from public.sport_positions sp where sp.sport_id=v_source.sport_id
    order by sp.sort_order,sp.id limit greatest(v_source.officials_needed,0)
  ) positions where positions.slot=v_source.slot+p_direction;
  if v_target_position is null then raise exception 'There is no position in that direction'; end if;
  select id into v_target_assignment from public.assignments where game_id=p_game_id
    and position_id=v_target_position and status<>'declined' order by assigned_at desc limit 1 for update;
  update public.assignments set position_id=v_target_position where id=p_assignment_id;
  if v_target_assignment is not null then
    update public.assignments set position_id=v_source.position_id where id=v_target_assignment;
  end if;
end; $$;

create or replace function private.create_organization_invitation_impl(
  p_organization_id uuid,
  p_email text,
  p_role text,
  p_viewer_permissions text[],
  p_league_ids uuid[]
) returns uuid
language plpgsql security definer set search_path='' as $$
declare
  v_id uuid;
  v_permissions text[] := case when p_role='viewer' then coalesce(p_viewer_permissions,'{}'::text[]) else '{}'::text[] end;
  v_league_ids uuid[] := case when p_role in ('admin','assignor','billing','viewer') then coalesce(p_league_ids,'{}'::uuid[]) else '{}'::uuid[] end;
begin
  if (select auth.uid()) is null then raise exception 'Authentication required.'; end if;
  if not private.can_manage_organization(p_organization_id) then raise exception 'Only organization owners and administrators can invite team members.'; end if;
  if p_role not in ('admin','assignor','billing','viewer') then raise exception 'Invalid role.'; end if;
  if position('@' in coalesce(p_email,''))<2 then raise exception 'Valid email required.'; end if;
  if not private.valid_viewer_permissions(v_permissions) then raise exception 'Invalid viewer permission.'; end if;
  if p_role='viewer' and cardinality(v_permissions)=0 then raise exception 'Select at least one section for this contact.'; end if;
  if p_role in ('assignor','viewer') and cardinality(v_league_ids)=0 then raise exception 'Select at least one league.'; end if;
  if not private.valid_organization_league_ids(p_organization_id,v_league_ids) then raise exception 'A selected league is not connected to this organization.'; end if;

  insert into public.organization_invitations(organization_id,email,role,viewer_permissions,league_ids,invited_by)
  values(p_organization_id,lower(trim(p_email)),p_role,v_permissions,v_league_ids,(select auth.uid()))
  on conflict(organization_id,email) do update
    set role=excluded.role,viewer_permissions=excluded.viewer_permissions,league_ids=excluded.league_ids,
        status='pending',accepted_at=null,invited_by=excluded.invited_by,created_at=now()
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function private.accept_my_organization_invitations_impl() returns integer language plpgsql security definer set search_path='' as $$
declare v_email text;v_count integer:=0;invitation record;begin
 if (select auth.uid()) is null then raise exception 'Authentication required.'; end if;
 select lower(email) into v_email from auth.users where id=(select auth.uid());
 for invitation in update public.organization_invitations set status='accepted',accepted_at=now() where lower(email)=v_email and status='pending' returning organization_id,roles,role,viewer_permissions,league_ids,league_access loop
  perform private.sync_organization_user_roles(invitation.organization_id,(select auth.uid()),case when cardinality(invitation.roles)>0 then invitation.roles else array[invitation.role] end,invitation.viewer_permissions,invitation.league_ids);
 perform private.apply_user_league_location_access(invitation.organization_id,(select auth.uid()),invitation.league_ids,invitation.league_access);v_count:=v_count+1;
 end loop;return v_count;end $$;

create or replace function private.get_organization_team_impl(p_organization_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if (select auth.uid()) is null or not private.can_manage_organization(p_organization_id) then raise exception 'Only organization owners and administrators can view team access.'; end if;
 return jsonb_build_object('members',coalesce((select jsonb_agg(jsonb_build_object('id',u.id,'user_id',u.id,'email',lower(u.email),'roles',coalesce(a.roles,'{}'::text[]),'viewer_permissions',coalesce(a.viewer_permissions,'{}'::text[]),'league_ids',coalesce(a.league_ids,'{}'::uuid[]),'league_access',coalesce((select jsonb_agg(jsonb_build_object('league_id',g.league_id,'all_locations',g.all_locations,'location_ids',g.location_ids)) from public.organization_member_league_access g where g.organization_id=p_organization_id and g.user_id=u.id),'[]'::jsonb),'owner',exists(select 1 from public.organization_memberships m where m.organization_id=p_organization_id and m.user_id=u.id and m.role='owner'),'status','active') order by lower(u.email)) from auth.users u join(select distinct user_id from public.organization_memberships where organization_id=p_organization_id union select user_id from public.organization_user_access_profiles where organization_id=p_organization_id) people on people.user_id=u.id left join public.organization_user_access_profiles a on a.organization_id=p_organization_id and a.user_id=u.id),'[]'::jsonb),'invitations',coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'email',lower(i.email),'roles',case when cardinality(i.roles)>0 then i.roles else array[i.role] end,'viewer_permissions',i.viewer_permissions,'league_ids',i.league_ids,'league_access',i.league_access,'status','pending') order by i.created_at desc) from public.organization_invitations i where i.organization_id=p_organization_id and i.status='pending'),'[]'::jsonb));
end $$;

create or replace function private.set_organization_official_eligibility(p_organization_id uuid,p_official_id uuid,p_league_ids uuid[],p_level_ids uuid[])
returns void language plpgsql security definer set search_path='' as $$
declare full_access boolean:=private.can_manage_organization(p_organization_id);
begin
 if not private.can_manage_any_organization_league(p_organization_id) then raise exception 'Not authorized.' using errcode='42501'; end if;
 if not exists(select 1 from public.organization_officials oo where oo.organization_id=p_organization_id and oo.official_id=p_official_id and oo.active)
 or not private.can_read_organization_official(p_organization_id,p_official_id) then raise exception 'Official is outside your access.' using errcode='42501'; end if;
 if exists(select 1 from unnest(coalesce(p_league_ids,'{}'::uuid[])) lid where not private.can_manage_organization_league_settings(p_organization_id,lid)) then raise exception 'A selected league is outside your whole-league access.' using errcode='42501'; end if;
 if not full_access and p_level_ids is not null then raise exception 'Only owners can change shared level eligibility.' using errcode='42501'; end if;
 -- Only mutable leagues are replaced. Omitted out-of-scope eligibility remains.
 delete from public.official_league_eligibility e where e.official_id=p_official_id and private.can_manage_organization_league_settings(p_organization_id,e.league_id);
 insert into public.official_league_eligibility(official_id,league_id) select p_official_id,lid from unnest(coalesce(p_league_ids,'{}'::uuid[])) lid on conflict do nothing;
 if p_level_ids is not null then
  if exists(select 1 from unnest(p_level_ids) lid where not exists(select 1 from public.organization_levels ol where ol.organization_id=p_organization_id and ol.level_id=lid and ol.active)) then raise exception 'A selected level is not connected to this organization.'; end if;
  delete from public.official_level_eligibility e where e.official_id=p_official_id and exists(select 1 from public.organization_levels ol where ol.organization_id=p_organization_id and ol.level_id=e.level_id);
  insert into public.official_level_eligibility(official_id,level_id) select p_official_id,lid from unnest(p_level_ids) lid on conflict do nothing;
 end if;
end $$;
create or replace function public.set_organization_official_position_eligibility(p_organization_id uuid,p_official_id uuid,p_league_ids uuid[] default '{}'::uuid[],p_center_level_ids uuid[] default '{}'::uuid[],p_ar_level_ids uuid[] default '{}'::uuid[])
returns void language plpgsql security definer set search_path='' as $$
declare v_level_ids uuid[];
begin
 if (p_center_level_ids is null) is distinct from (p_ar_level_ids is null) then raise exception 'Both shared level lists must be omitted together.'; end if;
 if p_center_level_ids is not null then
  select coalesce(array_agg(distinct id),'{}'::uuid[]) into v_level_ids from unnest(p_center_level_ids||p_ar_level_ids) id;
 end if;
 perform private.set_organization_official_eligibility(p_organization_id,p_official_id,p_league_ids,v_level_ids);
 if v_level_ids is not null then
  update public.official_level_eligibility e set center_eligible=e.level_id=any(p_center_level_ids),ar_eligible=e.level_id=any(p_ar_level_ids)
   where e.official_id=p_official_id and e.level_id=any(v_level_ids);
 end if;
end $$;

-- Exact selected locations are readable even before a game exists there.
-- All-locations grants may use existing venues and explicit sibling field groups;
-- restricted grants never inherit authority through a field_complex label.
create or replace function private.can_read_organization_location(p_organization_id uuid,p_location_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select (select auth.uid()) is not null and (private.can_manage_organization(p_organization_id)
  or exists(select 1 from public.organization_member_league_access a
   join public.organization_locations ol on ol.organization_id=a.organization_id and ol.location_id=p_location_id and ol.active
   join public.locations l on l.id=ol.location_id and l.active
   where a.organization_id=p_organization_id and a.user_id=(select auth.uid()) and not a.all_locations and p_location_id=any(a.location_ids)
    and private.can_access_organization_league(a.organization_id,a.league_id,(select auth.uid())))
  or exists(select 1 from public.games g where g.organization_id=p_organization_id
   and private.can_access_organization_league_location(g.organization_id,g.league_id,g.location_id,(select auth.uid()))
   and (g.location_id=p_location_id or (
    exists(select 1 from public.organization_member_league_access a where a.organization_id=g.organization_id and a.league_id=g.league_id and a.user_id=(select auth.uid()) and a.all_locations)
    and exists(select 1 from public.organization_locations source join public.organization_locations sibling on sibling.organization_id=source.organization_id
     and nullif(lower(trim(source.field_complex)),'')=nullif(lower(trim(sibling.field_complex)),'')
     where source.organization_id=p_organization_id and source.location_id=g.location_id and sibling.location_id=p_location_id and source.active and sibling.active)
   )))
 );
$$;

create or replace function public.set_my_official_assessment(
  p_official_id uuid,p_rank numeric,p_ref_rank numeric,p_ar1_rank numeric,
  p_ar2_rank numeric,p_fourth_rank numeric,p_mentor_certified boolean
)
returns void language plpgsql security invoker set search_path='' as $$
begin
  if auth.uid() is null then raise exception 'Sign in to save official ratings and certification' using errcode='42501'; end if;
  if p_mentor_certified is not null and not private.can_manage_shared_resource('official',p_official_id) then raise exception 'Only organization owners can change shared mentor certification.' using errcode='42501'; end if;
  if exists(select 1 from unnest(array[p_rank,p_ref_rank,p_ar1_rank,p_ar2_rank,p_fourth_rank]) value
    where value is null or value not between 1 and 10) then
    raise exception 'All performance rankings must be between 1 and 10';
  end if;
  insert into public.assignor_official_rankings(assignor_id,official_id,rank,ref_rank,ar1_rank,ar2_rank,fourth_rank,updated_at)
  values(auth.uid(),p_official_id,p_rank,p_ref_rank,p_ar1_rank,p_ar2_rank,p_fourth_rank,now())
  on conflict(assignor_id,official_id) do update set rank=excluded.rank,ref_rank=excluded.ref_rank,
    ar1_rank=excluded.ar1_rank,ar2_rank=excluded.ar2_rank,fourth_rank=excluded.fourth_rank,updated_at=now();
  if p_mentor_certified is not null then
  insert into public.official_mentor_certifications(official_id,certified,updated_by,updated_at)
  values(p_official_id,p_mentor_certified,auth.uid(),now())
  on conflict(official_id) do update set certified=excluded.certified,updated_by=auth.uid(),updated_at=now();
  end if;
end;
$$;

-- Retains the deployed center-first, position-specific eligibility algorithm.
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
  if not private.can_manage_organization(p_organization_id) then
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

create or replace function private.upsert_my_referee_profile_row(
  p_organization_id uuid, p_ussf_id text, p_first_name text, p_last_name text,
  p_date_of_birth date, p_is_minor boolean, p_gender text, p_ethnicity text,
  p_email text, p_secondary_email text, p_address text, p_address_unit text,
  p_city text, p_state text, p_zip text, p_country text, p_phone text,
  p_mobile_phone text, p_license text, p_status text, p_issue_date date,
  p_expiration_date date, p_issuer text, p_curriculum text,
  p_background_screening text, p_background_screening_expiration_date date,
  p_safesport text, p_safesport_expiration_date date, p_intro_player_safety text,
  p_intro_player_safety_expiration_date date, p_safe_soccer text,
  p_safe_soccer_expiration_date date, p_provisional_status text,
  p_referee_years_experience integer
) returns table(result_official_id uuid, result_action text)
language plpgsql security definer set search_path='' as $$
declare v_id uuid; v_action text;
begin
  if not private.can_manage_organization(p_organization_id) then raise exception 'You cannot import officials for this organization' using errcode='42501'; end if;
  if nullif(btrim(coalesce(p_first_name,'')),'') is null then raise exception 'Column First name: missing value'; end if;
  if nullif(btrim(coalesce(p_last_name,'')),'') is null then raise exception 'Column Last name: missing value'; end if;
  if p_referee_years_experience is not null and p_referee_years_experience < 0 then raise exception 'Column Referee years exp: must be zero or greater'; end if;
  begin
    if nullif(btrim(coalesce(p_ussf_id,'')),'') is not null then
      select o.id into v_id from public.officials o where o.id=p_ussf_id::uuid;
    end if;
  exception when invalid_text_representation then v_id:=null; end;
  if v_id is null and nullif(btrim(coalesce(p_email,'')),'') is not null then
    select o.id into v_id from public.officials o where lower(btrim(o.email))=lower(btrim(p_email)) limit 1;
  end if;
  if v_id is null then
    insert into public.officials(first_name,last_name,date_of_birth,is_minor,gender,ethnicity,email,
      secondary_email,home_address,address_unit,home_city,home_state,home_zip,country,phone,
      mobile_phone,license,license_status,license_issue_date,license_expiration_date,license_issuer,
      curriculum,background_screening,background_screening_expiration_date,safesport,
      safesport_expiration_date,intro_player_safety,intro_player_safety_expiration_date,safe_soccer,
      safe_soccer_expiration_date,provisional_status,referee_years_experience,sports,active)
    values(btrim(p_first_name),btrim(p_last_name),p_date_of_birth,coalesce(p_is_minor,false),
      nullif(btrim(coalesce(p_gender,'')),''),nullif(btrim(coalesce(p_ethnicity,'')),''),
      nullif(btrim(coalesce(p_email,'')),''),nullif(btrim(coalesce(p_secondary_email,'')),''),
      nullif(btrim(coalesce(p_address,'')),''),nullif(btrim(coalesce(p_address_unit,'')),''),
      nullif(btrim(coalesce(p_city,'')),''),nullif(btrim(coalesce(p_state,'')),''),
      nullif(btrim(coalesce(p_zip,'')),''),nullif(btrim(coalesce(p_country,'')),''),
      nullif(btrim(coalesce(p_phone,'')),''),nullif(btrim(coalesce(p_mobile_phone,'')),''),
      nullif(btrim(coalesce(p_license,'')),''),nullif(btrim(coalesce(p_status,'')),''),
      p_issue_date,p_expiration_date,nullif(btrim(coalesce(p_issuer,'')),''),
      nullif(btrim(coalesce(p_curriculum,'')),''),nullif(btrim(coalesce(p_background_screening,'')),''),
      p_background_screening_expiration_date,nullif(btrim(coalesce(p_safesport,'')),''),
      p_safesport_expiration_date,nullif(btrim(coalesce(p_intro_player_safety,'')),''),
      p_intro_player_safety_expiration_date,nullif(btrim(coalesce(p_safe_soccer,'')),''),
      p_safe_soccer_expiration_date,nullif(btrim(coalesce(p_provisional_status,'')),''),
      p_referee_years_experience,array['Soccer']::text[],true)
    returning id into v_id;
    v_action:='Add';
  else
    update public.officials o set first_name=btrim(p_first_name),last_name=btrim(p_last_name),
      date_of_birth=p_date_of_birth,is_minor=coalesce(p_is_minor,false),gender=nullif(btrim(coalesce(p_gender,'')),''),
      ethnicity=nullif(btrim(coalesce(p_ethnicity,'')),''),email=nullif(btrim(coalesce(p_email,'')),''),
      secondary_email=nullif(btrim(coalesce(p_secondary_email,'')),''),home_address=nullif(btrim(coalesce(p_address,'')),''),
      address_unit=nullif(btrim(coalesce(p_address_unit,'')),''),home_city=nullif(btrim(coalesce(p_city,'')),''),
      home_state=nullif(btrim(coalesce(p_state,'')),''),home_zip=nullif(btrim(coalesce(p_zip,'')),''),
      country=nullif(btrim(coalesce(p_country,'')),''),phone=nullif(btrim(coalesce(p_phone,'')),''),
      mobile_phone=nullif(btrim(coalesce(p_mobile_phone,'')),''),license=nullif(btrim(coalesce(p_license,'')),''),
      license_status=nullif(btrim(coalesce(p_status,'')),''),license_issue_date=p_issue_date,
      license_expiration_date=p_expiration_date,license_issuer=nullif(btrim(coalesce(p_issuer,'')),''),
      curriculum=nullif(btrim(coalesce(p_curriculum,'')),''),background_screening=nullif(btrim(coalesce(p_background_screening,'')),''),
      background_screening_expiration_date=p_background_screening_expiration_date,safesport=nullif(btrim(coalesce(p_safesport,'')),''),
      safesport_expiration_date=p_safesport_expiration_date,intro_player_safety=nullif(btrim(coalesce(p_intro_player_safety,'')),''),
      intro_player_safety_expiration_date=p_intro_player_safety_expiration_date,safe_soccer=nullif(btrim(coalesce(p_safe_soccer,'')),''),
      safe_soccer_expiration_date=p_safe_soccer_expiration_date,provisional_status=nullif(btrim(coalesce(p_provisional_status,'')),''),
      referee_years_experience=p_referee_years_experience,updated_at=now()
    where o.id=v_id;
    v_action:='Update';
  end if;
  insert into public.organization_officials(organization_id,official_id,active,added_by)
  values(p_organization_id,v_id,true,auth.uid())
  on conflict(organization_id,official_id) do update set active=true;
  result_official_id:=v_id; result_action:=v_action; return next;
end $$;

CREATE OR REPLACE FUNCTION public.get_game_crew_chat(p_game_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_uid uuid:=auth.uid(); v_result jsonb;
begin
 if v_uid is null then raise exception 'Not authenticated'; end if;
 if not (exists(select 1 from public.assignments a join public.officials o on o.id=a.official_id where a.game_id=p_game_id and o.auth_user_id=v_uid and a.status<>'declined') or private.can_read_organization_game(p_game_id,v_uid)) then raise exception 'Not authorized'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',m.id,'message',m.message,'created_at',m.created_at,'official_id',o.id,'name',coalesce(nullif(trim(o.full_name),''),trim(concat_ws(' ',o.first_name,o.last_name))),'profile_picture_url',o.profile_picture_url) order by m.created_at),'[]'::jsonb) into v_result
 from public.game_crew_messages m join public.officials o on o.id=m.official_id where m.game_id=p_game_id;
 return v_result;
end;$function$
;

CREATE OR REPLACE FUNCTION public.can_access_game_report(p_game_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
 select (select auth.uid()) is not null and (
   private.can_manage_game(p_game_id)
   or exists(select 1 from public.assignments a join public.officials o on o.id=a.official_id where a.game_id=p_game_id and o.auth_user_id=(select auth.uid()) and a.status <> 'declined')
 );
$function$
;

CREATE OR REPLACE FUNCTION public.resolve_overdue_assignments(p_assignment_ids uuid[], p_action text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_assignment record;
  v_count integer := 0;
  v_blocks integer := 0;
begin
  if coalesce(cardinality(p_assignment_ids),0)=0 or exists(
    select 1 from unnest(p_assignment_ids) requested(id)
    where not exists(select 1 from public.assignments a join public.games g on g.id=a.game_id
      where a.id=requested.id and private.can_manage_game(g.id)
        and (p_action is distinct from 'remove_and_block' or private.can_manage_organization(g.organization_id)))
  ) then raise exception 'Every requested assignment must be in your access; shared availability changes require an owner.' using errcode='42501'; end if;

  if p_action is null or p_action not in ('keep', 'remove', 'remove_and_block') then
    raise exception 'Choose keep, remove, or remove and block.';
  end if;

  for v_assignment in
    select a.id, a.official_id, g.starts_at, g.duration_minutes
    from public.assignments a
    join public.games g on g.id = a.game_id
    where a.id = any(p_assignment_ids)
      and a.status = 'proposed'
      and a.published_at is not null
      and a.accept_by < now()
      and a.overdue_reviewed_at is null
      and g.starts_at > now()
      and g.status not in ('canceled', 'rained_out')
    for update of a
  loop
    if p_action = 'keep' then
      update public.assignments
      set overdue_reviewed_at = now(),
          overdue_reviewed_by = (select auth.uid()),
          overdue_review_action = 'kept'
      where id = v_assignment.id;
    else
      if p_action = 'remove_and_block' and not exists (
        select 1 from public.official_availability_blocks b
        where b.official_id = v_assignment.official_id
          and b.block_type = 'time'
          and b.starts_at = v_assignment.starts_at
          and b.ends_at = v_assignment.starts_at + make_interval(mins => coalesce(v_assignment.duration_minutes, 110))
      ) then
        insert into public.official_availability_blocks (
          official_id, block_type, starts_at, ends_at, notes, created_by
        ) values (
          v_assignment.official_id,
          'time',
          v_assignment.starts_at,
          v_assignment.starts_at + make_interval(mins => coalesce(v_assignment.duration_minutes, 110)),
          'Created by assignor after missed assignment acceptance deadline',
          (select auth.uid())
        );
        v_blocks := v_blocks + 1;
      end if;

      delete from public.assignments where id = v_assignment.id;
    end if;
    v_count := v_count + 1;
  end loop;

  if v_count = 0 then
    raise exception 'These assignments are no longer overdue or have already been reviewed.';
  end if;

  return jsonb_build_object('assignments_resolved', v_count, 'blocks_created', v_blocks);
end;
$function$
;

-- Coverage-era templates and payroll tables must not keep organization-wide
-- reads/writes through older permissive policies or stale coverage-role rows.
create or replace function private.can_access_coverage_template(p_coverage_id uuid,p_write boolean default false)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.organization_league_coverage c where c.id=p_coverage_id and c.active
  and case when p_write then private.can_manage_organization_league_settings(c.organization_id,c.league_id)
   else private.can_access_organization_league(c.organization_id,c.league_id,(select auth.uid())) end);
$$;
create or replace function private.can_access_coverage_template_position(p_template_id uuid,p_write boolean default false)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.league_assignment_templates t where t.id=p_template_id and private.can_access_coverage_template(t.coverage_id,p_write));
$$;
revoke all on function private.can_access_coverage_template(uuid,boolean),private.can_access_coverage_template_position(uuid,boolean) from public,anon;
grant execute on function private.can_access_coverage_template(uuid,boolean),private.can_access_coverage_template_position(uuid,boolean) to authenticated;
do $coverage_template_fences$
declare t text; col text; helper text; cmd text; predicate text;
begin
 foreach t in array array['league_assignment_templates','league_assignment_template_positions'] loop
  col:=case when t='league_assignment_templates' then 'coverage_id' else 'template_id' end;
  helper:=case when t='league_assignment_templates' then 'private.can_access_coverage_template' else 'private.can_access_coverage_template_position' end;
  foreach cmd in array array['select','insert','update','delete'] loop
   predicate:=helper||'('||col||','||case when cmd='select' then 'false' else 'true' end||')';
   execute format('create policy %I on public.%I as restrictive for %s to authenticated %s %s','Coverage scope '||cmd||' fence',t,cmd,
     case when cmd<>'insert' then 'using('||predicate||')' else '' end,
     case when cmd in('insert','update') then 'with check('||predicate||')' else '' end);
   execute format('create policy %I on public.%I for %s to authenticated %s %s','Scoped coverage users '||cmd,t,cmd,
     case when cmd<>'insert' then 'using('||predicate||')' else '' end,
     case when cmd in('insert','update') then 'with check('||predicate||')' else '' end);
  end loop;
 end loop;
end $coverage_template_fences$;

create or replace function private.can_read_scoped_payroll_batch(p_batch_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.payroll_batches b where b.id=p_batch_id and (
  private.can_manage_organization(b.organization_id) or (
   private.can_access_organization_league(b.organization_id,b.league_id,(select auth.uid()))
   and exists(select 1 from public.payroll_batch_items i where i.payroll_batch_id=b.id)
   and not exists(select 1 from public.payroll_batch_items i left join public.games g on g.id=i.game_id
    where i.payroll_batch_id=b.id and (g.id is null or g.organization_id is distinct from b.organization_id
      or g.league_id is distinct from b.league_id
      or not private.can_access_organization_league_location(g.organization_id,g.league_id,g.location_id,(select auth.uid()))))
  )));
$$;
revoke all on function private.can_read_scoped_payroll_batch(uuid) from public,anon;
grant execute on function private.can_read_scoped_payroll_batch(uuid) to authenticated;
create policy "Payroll scope read fence" on public.payroll_batches as restrictive for select to authenticated
 using(private.can_read_scoped_payroll_batch(id));
create policy "Payroll scope read fence" on public.payroll_batch_items as restrictive for select to authenticated
 using(private.can_read_scoped_payroll_batch(payroll_batch_id) or exists(select 1 from public.officials o where o.id=official_id and o.auth_user_id=(select auth.uid())));
create policy "Payroll scope read fence" on public.payroll_transfers as restrictive for select to authenticated
 using(private.can_read_scoped_payroll_batch(payroll_batch_id) or exists(select 1 from public.officials o where o.id=official_id and o.auth_user_id=(select auth.uid())));
create policy "Payment scope read fence" on public.payment_transactions as restrictive for select to authenticated
 using(private.can_manage_organization(organization_id) or private.can_read_scoped_payroll_batch(related_record_id));
create policy "Payment scope read fence" on public.payment_audit_events as restrictive for select to authenticated
 using(private.can_manage_organization(organization_id) or private.can_read_scoped_payroll_batch(payroll_batch_id));
create policy "Payment scope read fence" on public.league_payment_settings as restrictive for select to authenticated
 using(private.can_manage_organization(organization_id) or private.can_access_organization_league(organization_id,league_id,(select auth.uid())));
create policy "Payment scope read fence" on public.transaction_fee_rules as restrictive for select to authenticated
 using(private.can_manage_organization(organization_id) or private.can_access_organization_league(organization_id,league_id,(select auth.uid())));

-- Do not let a scoped user attach a guessed hidden shared reference to a game,
-- thereby making the reference visible through the game's authorized history.
create or replace function private.validate_scoped_game_references()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if (select auth.uid()) is null or private.can_manage_organization(new.organization_id) then return new; end if;
 if not private.can_manage_organization_league_location(new.organization_id,new.league_id,new.location_id,(select auth.uid())) then
  raise exception 'The game is outside your access.' using errcode='42501';
 end if;
 if new.location_id is not null and (tg_op='INSERT' or new.location_id is distinct from old.location_id or new.organization_id is distinct from old.organization_id)
  and (not private.can_read_organization_location(new.organization_id,new.location_id)
   or not exists(select 1 from public.organization_locations ol join public.locations l on l.id=ol.location_id
     where ol.organization_id=new.organization_id and ol.location_id=new.location_id and ol.active and l.active)) then
  raise exception 'Location is outside your access.' using errcode='42501';
 end if;
 if new.home_team_id is not null and (tg_op='INSERT' or new.home_team_id is distinct from old.home_team_id or new.organization_id is distinct from old.organization_id)
  and not private.can_read_organization_team(new.organization_id,new.home_team_id) then raise exception 'Home team is outside your access.' using errcode='42501'; end if;
 if new.away_team_id is not null and (tg_op='INSERT' or new.away_team_id is distinct from old.away_team_id or new.organization_id is distinct from old.organization_id)
  and not private.can_read_organization_team(new.organization_id,new.away_team_id) then raise exception 'Away team is outside your access.' using errcode='42501'; end if;
 if new.level_id is not null and (tg_op='INSERT' or new.level_id is distinct from old.level_id or new.organization_id is distinct from old.organization_id)
  and not private.can_read_organization_level(new.organization_id,new.level_id) then raise exception 'Level is outside your access.' using errcode='42501'; end if;
 if new.bill_to_id is not null and (tg_op='INSERT' or new.bill_to_id is distinct from old.bill_to_id or new.organization_id is distinct from old.organization_id)
  and not exists(select 1 from public.games g where g.organization_id=new.organization_id and g.bill_to_id=new.bill_to_id
   and private.can_manage_organization_league_location(g.organization_id,g.league_id,g.location_id,(select auth.uid()))) then
  raise exception 'Billing account is outside your access.' using errcode='42501';
 end if;
 return new;
end;
$$;
revoke all on function private.validate_scoped_game_references() from public,anon,authenticated;
create trigger validate_scoped_game_references before insert or update on public.games
 for each row execute function private.validate_scoped_game_references();

-- Legacy globally shared ratings never inherit an administrative profile role.
create or replace function public.can_manage_rank()
returns boolean language sql stable security definer set search_path='' as $$ select public.is_super_admin(); $$;
create policy "Legacy rating scope read fence" on public.official_rankings as restrictive for select to authenticated
 using(private.can_read_scoped_resource('official',official_id));
create policy "Scoped users read legacy ratings" on public.official_rankings for select to authenticated
 using(private.can_read_scoped_resource('official',official_id));
create policy "Legacy rating scope insert fence" on public.official_rankings as restrictive for insert to authenticated
 with check(private.can_manage_shared_resource('official',official_id));
create policy "Legacy rating scope update fence" on public.official_rankings as restrictive for update to authenticated
 using(private.can_manage_shared_resource('official',official_id)) with check(private.can_manage_shared_resource('official',official_id));
create policy "Legacy rating scope delete fence" on public.official_rankings as restrictive for delete to authenticated
 using(private.can_manage_shared_resource('official',official_id));
create policy "Owners manage legacy ratings" on public.official_rankings for all to authenticated
 using(private.can_manage_shared_resource('official',official_id)) with check(private.can_manage_shared_resource('official',official_id));

-- League configuration cannot turn a guessed hidden shared resource into a grant.
CREATE OR REPLACE FUNCTION private.save_organization_league_teams_impl(p_organization_id uuid, p_league_id uuid, p_team_ids uuid[])
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if (select auth.uid()) is null or not private.can_manage_organization_league_settings(p_organization_id,p_league_id) then
    raise exception 'You may update only leagues assigned to you.' using errcode='42501';
  end if;
  if p_team_ids is null or exists (
    select 1 from unnest(p_team_ids) selected(team_id) where selected.team_id is null or not exists (
      select 1 from public.organization_teams ol join public.teams l on l.id=ol.team_id
      where ol.organization_id=p_organization_id and ol.team_id=selected.team_id and ol.active and l.active and private.can_read_organization_team(p_organization_id,selected.team_id)
    )
  ) then raise exception 'Choose active teams connected to this organization.'; end if;
  insert into private.organization_league_team_settings values (p_organization_id,p_league_id,array(select distinct unnest(p_team_ids)))
  on conflict (organization_id,league_id) do update set team_ids=excluded.team_ids;
  return true;
end $function$;
CREATE OR REPLACE FUNCTION private.save_organization_league_levels_impl(p_organization_id uuid, p_league_id uuid, p_level_ids uuid[])
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if (select auth.uid()) is null or not private.can_manage_organization_league_settings(p_organization_id,p_league_id) then
    raise exception 'You may update only leagues assigned to you.' using errcode='42501';
  end if;
  if p_level_ids is null or exists (
    select 1 from unnest(p_level_ids) selected(level_id) where selected.level_id is null or not exists (
      select 1 from public.organization_levels ol join public.levels l on l.id=ol.level_id
      where ol.organization_id=p_organization_id and ol.level_id=selected.level_id and ol.active and l.active and private.can_read_organization_level(p_organization_id,selected.level_id)
    )
  ) then raise exception 'Choose active levels connected to this organization.'; end if;
  insert into private.organization_league_level_settings values (p_organization_id,p_league_id,array(select distinct unnest(p_level_ids)))
  on conflict (organization_id,league_id) do update set level_ids=excluded.level_ids;
  return true;
end $function$;

-- An assignment must not manufacture access to a guessed hidden official.
-- Existing visible officials and the actor's own personal self-service remain.
create or replace function private.validate_scoped_assignment_reference()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_organization_id uuid;
begin
 if (select auth.uid()) is null or new.official_id is null then return new; end if;
 if tg_op='UPDATE' and new.official_id is not distinct from old.official_id and new.game_id is not distinct from old.game_id then return new; end if;
 select g.organization_id into v_organization_id from public.games g where g.id=new.game_id;
 if private.can_manage_organization(v_organization_id)
  or exists(select 1 from public.officials o where o.id=new.official_id and o.auth_user_id=(select auth.uid())) then return new; end if;
 if not private.can_read_organization_official(v_organization_id,new.official_id) then
  raise exception 'Official is outside your access.' using errcode='42501';
 end if;
 return new;
end;
$$;
revoke all on function private.validate_scoped_assignment_reference() from public,anon,authenticated;
create trigger validate_scoped_assignment_reference before insert or update of game_id,official_id on public.assignments
 for each row execute function private.validate_scoped_assignment_reference();

notify pgrst,'reload schema';
commit;
