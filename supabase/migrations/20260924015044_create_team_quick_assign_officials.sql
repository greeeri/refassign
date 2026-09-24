-- Organization-scoped suggestions for assigning officials to either side of a game.
create table public.team_quick_assign_officials (
  organization_id uuid not null,
  team_id uuid not null,
  official_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (organization_id, team_id, official_id),
  foreign key (organization_id, team_id) references public.organization_teams(organization_id, team_id) on delete cascade,
  foreign key (organization_id, official_id) references public.organization_officials(organization_id, official_id) on delete cascade
);
create index team_quick_assign_officials_official_idx on public.team_quick_assign_officials(official_id);
alter table public.team_quick_assign_officials enable row level security;
create policy "Members read team suggestions" on public.team_quick_assign_officials
  for select to authenticated using (private.can_access_organization(organization_id));
create policy "Managers add team suggestions" on public.team_quick_assign_officials
  for insert to authenticated with check (
    private.can_manage_organization(organization_id)
    and exists (select 1 from public.organization_teams t where t.organization_id = team_quick_assign_officials.organization_id and t.team_id = team_quick_assign_officials.team_id and t.active)
    and exists (select 1 from public.organization_officials o where o.organization_id = team_quick_assign_officials.organization_id and o.official_id = team_quick_assign_officials.official_id and o.active)
  );
create policy "Managers remove team suggestions" on public.team_quick_assign_officials
  for delete to authenticated using (private.can_manage_organization(organization_id));
revoke all on public.team_quick_assign_officials from anon;
grant select, insert, delete on public.team_quick_assign_officials to authenticated, service_role;
