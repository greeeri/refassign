create index if not exists organization_memberships_user_idx
  on public.organization_memberships(user_id);

create index if not exists organization_league_coverage_league_idx
  on public.organization_league_coverage(league_id);
create index if not exists organization_league_coverage_location_idx
  on public.organization_league_coverage(location_id)
  where location_id is not null;

create index if not exists organization_officials_official_idx
  on public.organization_officials(official_id);
create index if not exists organization_officials_added_by_idx
  on public.organization_officials(added_by)
  where added_by is not null;

create index if not exists organization_locations_location_idx
  on public.organization_locations(location_id);
create index if not exists organization_locations_added_by_idx
  on public.organization_locations(added_by)
  where added_by is not null;

create index if not exists organization_member_league_access_user_idx
  on public.organization_member_league_access(user_id);
create index if not exists organization_member_league_access_league_idx
  on public.organization_member_league_access(league_id);
