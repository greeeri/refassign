-- Avoid overlapping permissive SELECT policies while retaining full manager access.
drop policy if exists "Managers manage organization levels" on public.organization_levels;
drop policy if exists "Managers manage organization teams" on public.organization_teams;
drop policy if exists "Managers add organization levels" on public.organization_levels;
drop policy if exists "Managers update organization levels" on public.organization_levels;
drop policy if exists "Managers remove organization levels" on public.organization_levels;
drop policy if exists "Managers add organization teams" on public.organization_teams;
drop policy if exists "Managers update organization teams" on public.organization_teams;
drop policy if exists "Managers remove organization teams" on public.organization_teams;

create policy "Managers add organization levels" on public.organization_levels
for insert to authenticated with check (private.can_manage_organization(organization_id));
create policy "Managers update organization levels" on public.organization_levels
for update to authenticated using (private.can_manage_organization(organization_id))
with check (private.can_manage_organization(organization_id));
create policy "Managers remove organization levels" on public.organization_levels
for delete to authenticated using (private.can_manage_organization(organization_id));

create policy "Managers add organization teams" on public.organization_teams
for insert to authenticated with check (private.can_manage_organization(organization_id));
create policy "Managers update organization teams" on public.organization_teams
for update to authenticated using (private.can_manage_organization(organization_id))
with check (private.can_manage_organization(organization_id));
create policy "Managers remove organization teams" on public.organization_teams
for delete to authenticated using (private.can_manage_organization(organization_id));
