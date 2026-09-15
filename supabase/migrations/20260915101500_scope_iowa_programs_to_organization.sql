-- Attach Iowa Soccer registration and development programs to the Iowa Soccer
-- organization while retaining stable program IDs and all dependent records.

alter table public.registration_programs
  add column if not exists organization_id uuid references public.organizations(id) on delete restrict;

update public.registration_programs
set organization_id = '3bef75a5-be0f-41e3-a03d-853c62ccedf0'::uuid,
    updated_at = now()
where slug in ('iowa-soccer','small-sided-referee-course');

do $$
begin
  if exists (
    select 1 from public.registration_programs where organization_id is null
  ) then
    raise exception 'Every registration program must be assigned to an organization before organization_id can be required.';
  end if;
end;
$$;

alter table public.registration_programs
  alter column organization_id set not null;

create index if not exists registration_programs_organization_idx
  on public.registration_programs(organization_id,active,slug);

-- Program officials become active Iowa Soccer officials too. Existing links to
-- Test or any other organization remain untouched.
insert into public.organization_officials(
  organization_id,official_id,active,added_by,joined_at
)
select
  program.organization_id,
  membership.official_id,
  true,
  membership.added_by,
  membership.added_at
from public.registration_program_officials membership
join public.registration_programs program on program.id=membership.program_id
where program.slug in ('iowa-soccer','small-sided-referee-course')
on conflict(organization_id,official_id) do update
set active=true;

create or replace function public.can_manage_registration_program(p_program_id uuid)
returns boolean
language sql
stable
security definer
set search_path=''
as $$
  select public.is_super_admin() or exists(
    select 1
    from public.registration_program_staff access
    join public.registration_programs program on program.id=access.program_id
    join public.profiles profile on profile.id=access.user_id
    where access.user_id=(select auth.uid())
      and access.program_id=p_program_id
      and access.role in ('admin','registrar')
      and profile.active=true
      and private.can_access_organization(program.organization_id)
  );
$$;

create or replace function public.has_registration_program_access(p_program_id uuid)
returns boolean
language sql
stable
security definer
set search_path=''
as $$
  select exists(
    select 1
    from public.registration_program_officials membership
    join public.registration_programs program on program.id=membership.program_id
    join public.officials official on official.id=membership.official_id
    join public.organization_officials organization_official
      on organization_official.organization_id=program.organization_id
     and organization_official.official_id=official.id
     and organization_official.active
    where membership.program_id=p_program_id
      and official.auth_user_id=(select auth.uid())
      and official.active=true
  );
$$;

create or replace function public.is_iowa_soccer_development_staff()
returns boolean
language sql
stable
security definer
set search_path=''
as $$
  select exists(
    select 1
    from public.registration_programs program
    where program.slug='iowa-soccer'
      and program.active=true
      and public.can_manage_registration_program(program.id)
  );
$$;

create or replace function public.is_iowa_soccer_development_mentor()
returns boolean
language sql
stable
security definer
set search_path=''
as $$
  select exists(
    select 1
    from public.development_mentors mentor
    join public.registration_programs program on program.id=mentor.program_id
    join public.officials official on official.id=mentor.official_id
    join public.organization_officials organization_official
      on organization_official.organization_id=program.organization_id
     and organization_official.official_id=official.id
     and organization_official.active
    where program.slug='iowa-soccer'
      and program.active=true
      and official.auth_user_id=(select auth.uid())
      and official.active=true
  );
$$;

create or replace function public.can_access_iowa_development_records()
returns boolean
language sql
stable
security definer
set search_path=''
as $$
  select public.is_super_admin()
    or public.is_iowa_soccer_development_staff()
    or public.is_iowa_soccer_development_mentor();
$$;

revoke all on function public.can_manage_registration_program(uuid) from public,anon;
revoke all on function public.has_registration_program_access(uuid) from public,anon;
revoke all on function public.is_iowa_soccer_development_staff() from public,anon;
revoke all on function public.is_iowa_soccer_development_mentor() from public,anon;
revoke all on function public.can_access_iowa_development_records() from public,anon;
grant execute on function public.can_manage_registration_program(uuid) to authenticated;
grant execute on function public.has_registration_program_access(uuid) to authenticated;
grant execute on function public.is_iowa_soccer_development_staff() to authenticated;
grant execute on function public.is_iowa_soccer_development_mentor() to authenticated;
grant execute on function public.can_access_iowa_development_records() to authenticated;

notify pgrst,'reload schema';
