create table if not exists public.official_email_groups (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check(length(trim(name)) between 1 and 80), created_by uuid not null references auth.users(id) default auth.uid(),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(id,organization_id));
create unique index if not exists official_email_groups_organization_name_idx on public.official_email_groups(organization_id,lower(trim(name)));
create table if not exists public.official_email_group_members (
  group_id uuid not null, organization_id uuid not null, official_id uuid not null references public.officials(id) on delete cascade,
  added_at timestamptz not null default now(), primary key(group_id,official_id),
  foreign key(group_id,organization_id) references public.official_email_groups(id,organization_id) on delete cascade);
alter table public.official_email_groups enable row level security;
alter table public.official_email_group_members enable row level security;
grant select,insert,update,delete on public.official_email_groups to authenticated;
grant select,insert,delete on public.official_email_group_members to authenticated;
create policy "Organization managers read email groups" on public.official_email_groups for select to authenticated using ((select private.can_manage_organization(organization_id)));
create policy "Organization managers create email groups" on public.official_email_groups for insert to authenticated with check(created_by=(select auth.uid()) and (select private.can_manage_organization(organization_id)));
create policy "Organization managers update email groups" on public.official_email_groups for update to authenticated using ((select private.can_manage_organization(organization_id))) with check ((select private.can_manage_organization(organization_id)));
create policy "Organization managers delete email groups" on public.official_email_groups for delete to authenticated using ((select private.can_manage_organization(organization_id)));
create policy "Organization managers read email group members" on public.official_email_group_members for select to authenticated using ((select private.can_manage_organization(organization_id)));
create policy "Organization managers add email group members" on public.official_email_group_members for insert to authenticated with check((select private.can_manage_organization(organization_id)) and exists(select 1 from public.organization_officials x where x.organization_id=official_email_group_members.organization_id and x.official_id=official_email_group_members.official_id and x.active));
create policy "Organization managers remove email group members" on public.official_email_group_members for delete to authenticated using ((select private.can_manage_organization(organization_id)));
